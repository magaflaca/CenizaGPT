const { generateImage, editImage } = require('./pollinationsBridge');
const {
  canUseNanobanana,
  consumeNanobanana,
  remainingNanobanana,
  canUseNanobananaGlobal,
  consumeNanobananaGlobal,
  remainingNanobananaGlobal,
} = require('./usageLimits');
const { fallbackEditToGenerate } = require('./fallbackEdit');
const { describeImageWithMeta } = require('../vision/imageMentionHandler');

const {
  extractModelIdFromText,
  extractSizeFromText,
  extractSeedFromText,
  stripControlTokens,
} = require('./promptParse');

function mapModelLabelToId(label) {
  const t = String(label || '').trim().toLowerCase();
  if (!t) return null;
  if (t.includes('flux')) return 'flux';
  if (t.includes('zimage') || t.includes('zeniza')) return 'zimage';
  if (t.includes('turbo') || t.includes('ceniturbo')) return 'turbo';
  if (t.includes('nanobanana') || t.includes('nanoceniza')) return 'nanobanana';
  return null;
}

function labelFromModelId(modelId) {
  const id = String(modelId || '').toLowerCase();
  if (id === 'flux') return 'fluxeniza';
  if (id === 'zimage') return 'zeniza';
  if (id === 'turbo') return 'ceniturbo';
  if (id === 'nanobanana') return 'nanoceniza pro';
  return id || 'fluxeniza';
}

/**
 * Normaliza resultados de los bridges para evitar enviar attachments inválidos.
 * Acepta:
 *  - { buffer: Buffer }
 *  - { b64/base64: string }
 *  - { url: string }
 */
function normalizeImageResult(res) {
  const out = { ok: false, seed: 0, buffer: null, url: null, error: null };

  if (!res || typeof res !== 'object') {
    out.error = 'resultado vacío';
    return out;
  }

  if (Number.isFinite(Number(res.seed))) out.seed = Number(res.seed);

  // 1) buffer directo
  if (res.buffer && Buffer.isBuffer(res.buffer)) {
    out.ok = true;
    out.buffer = res.buffer;
    out.url = res.url ? String(res.url) : null;
    return out;
  }

  // 2) base64
  const b64 = res.b64 || res.base64 || null;
  if (typeof b64 === 'string' && b64.trim().length > 50) {
    try {
      out.ok = true;
      out.buffer = Buffer.from(b64, 'base64');
      out.url = res.url ? String(res.url) : null;
      return out;
    } catch (_e) {
      // sigue
    }
  }

  // 3) url
  if (typeof res.url === 'string' && /^https?:\/\//i.test(res.url)) {
    out.ok = true;
    out.url = String(res.url);
    return out;
  }

  // 4) error textual
  if (res.error) out.error = String(res.error);
  return out;
}

function findFirstImageUrlFromMessage(message) {
  // attachments (Collection en discord.js)
  const att = message?.attachments?.find?.((a) => {
    const ct = String(a?.contentType || '');
    if (ct.startsWith('image/')) return true;
    const n = String(a?.name || '').toLowerCase();
    return n.match(/\.(png|jpg|jpeg|webp|gif)$/i);
  });
  if (att?.url) return att.url;

  // embeds
  const emb = (message?.embeds || []).find((e) => e?.image?.url || e?.thumbnail?.url);
  if (emb?.image?.url) return emb.image.url;
  if (emb?.thumbnail?.url) return emb.thumbnail.url;

  // content url
  const m = String(message?.content || '').match(/https?:\/\/[^\s>]+/i);
  if (m) return m[0];

  return null;
}

function findImageUrlFromMessageOrReply({ message, repliedMessage }) {
  return findFirstImageUrlFromMessage(message) || findFirstImageUrlFromMessage(repliedMessage);
}

async function replyWithImageOrLink(message, { content, img, filename = 'ceniza.png' }) {
  if (!img?.ok) {
    await message.reply('⚠️ no pude generar la imagen ahora mismo.');
    return true;
  }

  // Preferimos adjuntar buffer si existe
  if (img.buffer && Buffer.isBuffer(img.buffer)) {
    await message.reply({
      content,
      files: [{ attachment: img.buffer, name: filename }],
    });
    return true;
  }

  // Si no hay buffer, mandamos link (evita crash)
  if (img.url) {
    await message.reply(`${content}\n${img.url}`);
    return true;
  }

  await message.reply('⚠️ se generó un resultado inválido ');
  return true;
}

async function runChatDraw({ message, promptText, modelLabel, width, height, seed }) {
  const raw = String(promptText || '').trim();
  if (!raw) {
    await message.reply('decime qué querés que dibuje. ej: `@ceniza dibuja un slime con sombrero (ceniturbo)`');
    return true;
  }

  const cleaned = stripControlTokens(raw);

  const modelId = mapModelLabelToId(modelLabel) || extractModelIdFromText(raw) || 'flux';
  const size = (width && height) ? { w: Number(width), h: Number(height) } : extractSizeFromText(raw);
  const w = Math.max(256, Math.min(2048, Number(size?.w || 1024)));
  const h = Math.max(256, Math.min(2048, Number(size?.h || 1024)));
  const seedFinal = Number.isFinite(Number(seed)) ? Number(seed) : (extractSeedFromText(raw) ?? 0);

  // nunca nanobanana desde chat draw
  const safeModelId = modelId === 'nanobanana' ? 'flux' : modelId;

  await message.channel.sendTyping();

  let res;
  try {
    res = await generateImage({ prompt: cleaned, modelId: safeModelId, width: w, height: h, seed: seedFinal });
  } catch (e) {
    console.error('[chat draw] generateImage error:', e);
    await message.reply('⚠️ no pude generar la imagen ahora mismo. avisale a @isawicca');
    return true;
  }

  const img = normalizeImageResult(res);
  const content = `🖼️Listo · Modelo: ${labelFromModelId(safeModelId)} · ${w}x${h} `;

  return replyWithImageOrLink(message, { content, img, filename: 'ceniza.png' });
}

async function runChatEdit({
  message,
  userId,
  promptText,
  repliedMessage,

  // compat: algunos callers mandan modelLabel, otros fallbackModelLabel
  modelLabel,
  fallbackModelLabel,

  width,
  height,
  seed,

  // compat: algunos callers mandan imageUrlOverride, otros imageUrl
  imageUrlOverride,
  imageUrl,
}) {
  const uid = userId || message?.author?.id || null;

  const raw = String(promptText || '').trim();
  const cleaned = stripControlTokens(raw);

  const finalImageUrl =
    (imageUrlOverride && String(imageUrlOverride).trim()) ||
    (imageUrl && String(imageUrl).trim()) ||
    findImageUrlFromMessageOrReply({ message, repliedMessage });

  if (!finalImageUrl) {
    await message.reply('para editar necesito una imagen: respondé a una imagen, adjuntala, o pegá una url directa de imagen.');
    return true;
  }

  if (!cleaned) {
    await message.reply('decime qué cambio querés hacer. ej: `@ceniza edita: pon el pelo rojo`');
    return true;
  }

  const picked =
    mapModelLabelToId(modelLabel) ||
    mapModelLabelToId(fallbackModelLabel) ||
    extractModelIdFromText(raw) ||
    'turbo';

  const size = (width && height) ? { w: Number(width), h: Number(height) } : extractSizeFromText(raw);
  const w = Math.max(256, Math.min(2048, Number(size?.w || 1024)));
  const h = Math.max(256, Math.min(2048, Number(size?.h || 1024)));
  const seedFinal = Number.isFinite(Number(seed)) ? Number(seed) : (extractSeedFromText(raw) ?? 0);

  await message.channel.sendTyping();

  // si por alguna razón uid no existe, forzamos fallback (sin nanobanana)
  const canCheckUser = !!uid;

  const okUser = canCheckUser ? canUseNanobanana(uid) : false;
  const okGlobal = canUseNanobananaGlobal();

  if (okUser && okGlobal) {
    // usar nanobanana
    consumeNanobanana(uid);
    consumeNanobananaGlobal();

    let res;
    try {
      res = await editImage({ imageUrl: finalImageUrl, prompt: cleaned, modelId: 'nanobanana', seed: seedFinal });
    } catch (e) {
      console.error('[chat edit] nanobanana edit error:', e);
      res = null;
    }

    const img = normalizeImageResult(res);
    if (img.ok) {
      const leftUser = remainingNanobanana(uid);
      const leftGlobal = remainingNanobananaGlobal();

      const content = `✏️ Listo · Nanoceniza-Pro · Intentos hoy: ${leftUser}/2 · Global: ${leftGlobal}/15 `;
      return replyWithImageOrLink(message, { content, img, filename: 'ceniza_edit.png' });
    }
    // si falló nanobanana, seguimos a fallback para no dejar al usuario colgado
  }

  // fallback: describir + regenerar
  const leftUser = canCheckUser ? remainingNanobanana(uid) : 0;
  const leftGlobal = remainingNanobananaGlobal();
  const fallbackModel = (picked === 'nanobanana') ? 'turbo' : picked;

  let out;
  try {
    out = await fallbackEditToGenerate({
      imageUrl: finalImageUrl,
      userEditPrompt: cleaned,
      modelId: fallbackModel,
      seed: seedFinal || 0,
      width: w,
      height: h,
      describeFn: describeImageWithMeta,
      generateFn: generateImage,
    });
  } catch (e) {
    console.error('[chat edit] fallbackEditToGenerate error:', e);
    await message.reply('⚠️ no pude editar esa imagen ahora mismo (modelo alternativo).');
    return true;
  }

  const img = normalizeImageResult(out);

  const content =
    `⚠️ Edición con Nanoceniza no disponible ahora (Tus intentos: ${leftUser}/2 · Global: ${leftGlobal}/15). \n` +
    `Se usó un modelo alternativo para tu edición.\n` +
    `Modelo: ${labelFromModelId(fallbackModel)}`;

  return replyWithImageOrLink(message, { content, img, filename: 'ceniza_edit.png' });
}

module.exports = {
  runChatDraw,
  runChatEdit,
  findImageUrlFromMessageOrReply,
};
