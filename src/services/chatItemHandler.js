const { chunkString, normalize } = require('../utils/text');
const { answerAboutItem } = require('./terrariaChat');

function extractPossibleItemId(text) {
  const m = String(text || '').match(/\b(\d{1,5})\b/);
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isFinite(id) ? id : null;
}

async function handleChatItem({ message, ctx, cleanText, itemQuery, question }) {
  if (!message.guild) {
    await message.reply('esto solo funciona dentro de un servidor (por ahora).');
    return true;
  }

  const guildId = message.guild.id;
  const userId = message.author.id;
  const channelName = message.channel?.name || '';

  const q = String(itemQuery || '').trim();
  const userQ = String(question || '').trim();

  let item = null;
  let pickedName = q;

  // 1) Si nos pasaron un query explícito, usarlo.
  if (q) {
    const maybeId = extractPossibleItemId(q);
    if (maybeId != null) item = ctx.itemsIndex.findById(maybeId);
    if (!item) {
      const hit = ctx.itemsIndex.findBest(q, { strict: false });
      item = hit?.item || null;
    }
  }

  // 2) Si no, intentar detectar en el mensaje completo
  if (!item) {
    const det = ctx.itemsIndex.detectItemInMessage(cleanText, { channelName });
    if (det?.item) {
      item = det.item;
      pickedName = det.phrase || det.item.name_es || det.item.name;
    }
  }

  // 3) Fallback: best-effort (pero más conservador)
  if (!item) {
    const hit = ctx.itemsIndex.findBest(cleanText, { strict: false });
    // Fuse score: 0 = perfecto. si es muy alto, probablemente es falso positivo.
    if (hit?.item && typeof hit.score === 'number' && hit.score <= 0.22) {
      item = hit.item;
      pickedName = hit.item.name_es || hit.item.name;
    }
  }

  if (!item) {
    // si parece tema terraria, guiar
    const t = normalize(cleanText);
    const looksTerraria = ctx.itemsIndex.looksLikeTerrariaTopic(cleanText, { channelName });
    if (looksTerraria || t.includes('terraria')) {
      await message.reply(
        'si es un **item de terraria**, decime el nombre (es o en) o el id.\n' +
          'podés usar:\n' +
          '- **/item info <nombre o id>**\n' +
          '- **/item ask <nombre o id> <pregunta>**\n' +
          'si no te funcionan los slash:\n' +
          '- `!item info <nombre o id>`\n' +
          '- `!item ask <nombre o id> <pregunta>`'
      );
      return true;
    }

    await message.reply('no encontré un item claro en tu mensaje. probá decir el nombre exacto o el id.');
    return true;
  }

  try {
    await message.channel.sendTyping();
    const userText = userQ || cleanText;

    const out = await answerAboutItem({
      memoryStore: ctx.memoryStore,
      guildId,
      userId,
      item,
      userText,
      includeTip: true,
    });

    for (const part of chunkString(out, 1900)) {
      await message.reply(part);
    }
  } catch (e) {
    console.error('[chatItem] Error:', e);
    await message.reply('⚠️ no pude consultar ese item ahora mismo. probá de nuevo más tarde.');
  }

  return true;
}

module.exports = {
  handleChatItem,
};
