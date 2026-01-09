// src/pollinations/editMentionHandler.js
const fs = require('node:fs');
const { AttachmentBuilder } = require('discord.js');
const { editImage } = require('./pollinationsBridge');
const { consumeNanobanana } = require('./usageLimits');
const { fallbackEditToGenerate } = require('./fallbackEdit');
const { normalize } = require('../utils/text');

function pickImageUrlFromMessage(msg) {
  if (!msg) return null;
  const att = msg.attachments?.find?.((a) => {
    const ct = a.contentType || '';
    return ct.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(a.url || '');
  });
  return att?.url || null;
}

function hasEditTag(text) {
  const t = normalize(text);
  return t.includes('@editar') || t.includes(' editar');
}

function stripMentions(raw) {
  return String(raw || '').replace(/<@!?[0-9]{16,20}>/g, ' ').trim();
}

async function maybeHandleEditMention({ message, clientUserId }) {
  if (!message.guild) return false;
  if (message.author?.bot) return false;

  const mentioned = message.mentions?.users?.has(clientUserId);
  if (!mentioned) return false;

  if (!hasEditTag(message.content)) return false;
  if (!message.reference?.messageId) return false;

  const replied = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
  const imageUrl = pickImageUrlFromMessage(replied);
  if (!imageUrl) return false;

  const prompt = stripMentions(message.content).replace(/@editar/gi, '').trim();
  if (!prompt) {
    await message.reply('Escribe el prompt junto con @editar. Ej: `@Ceniza @editar hazlo estilo anime`');
    return true;
  }

  // intentar nanobanana con límites
  const lim = consumeNanobanana({
    userId: message.author.id,
    userKind: 'edits',
    userLimit: 2,
    globalLimit: 15,
  });

  if (!lim.ok) {
    // fallback
    try {
      await message.channel.sendTyping();
      const fb = await fallbackEditToGenerate({ imageUrl, userPrompt: prompt });

      await message.reply({
        content:
          `⚠️ Edición nanoceniza no disponible ahora (${lim.scope === 'global' ? 'límite global 15/día' : 'límite usuario 2/día'}). ` +
          `Se usarán otros modelos.\n` +
          `**Modelo:** ${fb.modelLabel} | **Seed:** ${fb.seed}`.slice(0, 1900),
        files: [fb.attachment],
      });
      return true;
    } catch (e) {
      console.error('[editMention:fallback] Error:', e);
      await message.reply(
        `⚠️ No hay cupo para nanoceniza (${lim.scope === 'global' ? 'global 15/día' : '2/día'}), y además falló el fallback.`
      );
      return true;
    }
  }

  // nanobanana edit normal
  try {
    await message.channel.sendTyping();
    const out = await editImage({ prompt, imageUrl, seed: 0 });
    const buf = fs.readFileSync(out.file);
    const attachment = new AttachmentBuilder(buf, { name: 'ceniza_edit.png' });

    await message.reply({
      content:
        `✏️ **Edición (nanoceniza)**\n` +
        `**Uso hoy:** ${lim.user.used}/${lim.user.limit} (usuario) | ${lim.global.used}/${lim.global.limit} (global)\n` +
        `**Prompt:** ${prompt}`.slice(0, 1900),
      files: [attachment],
    });
    return true;
  } catch (e) {
    console.error('[editMention] Error:', e);
    await message.reply('No pude editar esa imagen ahora mismo.');
    return true;
  }
}

module.exports = { maybeHandleEditMention };
