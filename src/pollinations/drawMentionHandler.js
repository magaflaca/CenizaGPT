// src/pollinations/drawMentionHandler.js
const fs = require('node:fs');
const { AttachmentBuilder } = require('discord.js');
const { generateImage } = require('./pollinationsBridge');
const { normalize } = require('../utils/text');

function hasDrawTag(text) {
  const t = normalize(text);
  return t.includes('@dibujar') || t.includes(' dibujar') || t.startsWith('dibujar');
}

function stripMentions(raw) {
  return String(raw || '').replace(/<@!?[0-9]{16,20}>/g, ' ').trim();
}

function pickModelFromText(text) {
  const t = normalize(text);

  // Nunca nanoceniza pro
  if (t.includes('nanoceniza') || t.includes('nanobanana') || t.includes('pro')) {
    // ignorar y seguir con defaults / otros
  }

  if (t.includes('ceniturbo') || t.includes('turbo')) return { label: 'ceniturbo', id: process.env.POLLINATIONS_MODEL_TURBO || 'turbo' };
  if (t.includes('zeniza') || t.includes('zimage')) return { label: 'zeniza', id: process.env.POLLINATIONS_MODEL_ZIMAGE || 'zimage' };
  if (t.includes('fluxeniza') || t.includes('flux')) return { label: 'fluxeniza', id: process.env.POLLINATIONS_MODEL_FLUX || 'flux' };

  return { label: 'fluxeniza', id: process.env.POLLINATIONS_MODEL_FLUX || 'flux' };
}

function parseSizeAndAspect(text) {
  const t = normalize(text);

  // default: cuadrado 1024
  let w = 1024;
  let h = 1024;

  // 1) "1080x1920"
  const mDim = String(text || '').match(/\b(\d{3,4})\s*x\s*(\d{3,4})\b/i);
  if (mDim) {
    const ww = Number(mDim[1]);
    const hh = Number(mDim[2]);
    if (Number.isFinite(ww) && Number.isFinite(hh)) {
      // clamp simple para evitar locuras
      w = Math.max(256, Math.min(1536, ww));
      h = Math.max(256, Math.min(1536, hh));
      return { w, h, note: `${w}x${h}` };
    }
  }

  // 2) "16:9", "9:16", "4:3", etc.
  const mRatio = String(text || '').match(/\b(\d{1,2})\s*:\s*(\d{1,2})\b/);
  if (mRatio) {
    const a = Number(mRatio[1]);
    const b = Number(mRatio[2]);
    if (a > 0 && b > 0 && a <= 32 && b <= 32) {
      // base size: 1024 en el lado mayor
      if (a >= b) {
        w = 1024;
        h = Math.round((1024 * b) / a);
      } else {
        h = 1024;
        w = Math.round((1024 * a) / b);
      }
      // clamp
      w = Math.max(256, Math.min(1536, w));
      h = Math.max(256, Math.min(1536, h));
      return { w, h, note: `${a}:${b}` };
    }
  }

  // 3) keywords: horizontal / vertical / cuadrado
  if (t.includes('vertical') || t.includes('retrato') || t.includes('portrait')) {
    w = 768;
    h = 1024;
    return { w, h, note: 'vertical' };
  }
  if (t.includes('horizontal') || t.includes('paisaje') || t.includes('landscape') || t.includes('panoram')) {
    w = 1024;
    h = 768;
    return { w, h, note: 'horizontal' };
  }
  if (t.includes('cuadrad') || t.includes('square') || t.includes('1:1')) {
    w = 1024;
    h = 1024;
    return { w, h, note: 'cuadrado' };
  }

  // 4) tamaño simple: 512 / 1024
  const mSize = t.match(/\b(512|768|1024|1280|1536)\b/);
  if (mSize) {
    const s = Number(mSize[1]);
    w = s; h = s;
    return { w, h, note: `${s}x${s}` };
  }

  return { w, h, note: '1024x1024' };
}

function cleanPrompt(text) {
  // quitar tags de activación y nombres de modelo para que no ensucie el prompt
  let s = String(text || '');
  s = s.replace(/@dibujar/gi, ' ');
  s = s.replace(/\b(fluxeniza|zeniza|ceniturbo|flux|zimage|turbo)\b/gi, ' ');
  s = s.replace(/\b(nanoceniza|nanobanana|pro)\b/gi, ' '); // nunca nano
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

async function maybeHandleDrawMention({ message, clientUserId }) {
  if (!message.guild) return false;
  if (message.author?.bot) return false;

  const mentioned = message.mentions?.users?.has(clientUserId);
  if (!mentioned) return false;

  if (!hasDrawTag(message.content)) return false;

  const raw = stripMentions(message.content);
  const model = pickModelFromText(raw);
  const { w, h, note } = parseSizeAndAspect(raw);

  const prompt = cleanPrompt(raw);
  if (!prompt || prompt.length < 3) {
    await message.reply('Escribe el prompt junto con **@dibujar**. Ej: `@Ceniza @dibujar un slime con sombrero, zeniza, 16:9`');
    return true;
  }

  try {
    await message.channel.sendTyping();

    const out = await generateImage({
      prompt,
      modelId: model.id,
      seed: 0,
      width: w,
      height: h,
    });

    const buf = fs.readFileSync(out.file);
    const attachment = new AttachmentBuilder(buf, { name: 'ceniza.png' });

    await message.reply({
      content: `🖼️ **@dibujar** | **Modelo:** ${model.label} | **Tamaño:** ${note} | **Seed:** ${out.seed}\n**Prompt:** ${prompt}`.slice(0, 1900),
      files: [attachment],
    });

    return true;
  } catch (e) {
    console.error('[drawMention] Error:', e);
    await message.reply('No pude generar esa imagen ahora mismo.');
    return true;
  }
}

module.exports = { maybeHandleDrawMention };
