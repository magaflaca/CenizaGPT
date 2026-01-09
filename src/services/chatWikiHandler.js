const { chunkString } = require('../utils/text');
const { terrariaSummarize, terrariaAsk } = require('../terraria/terrariaBridge');

function extractFirstUrl(text) {
  const m = String(text || '').match(/https?:\/\/[^\s>]+/i);
  return m ? m[0] : null;
}

async function handleChatWiki({ message, cleanText, url, question }) {
  const pickedUrl = url || extractFirstUrl(cleanText);
  if (!pickedUrl) {
    await message.reply('pegá un link (http/https) y te lo resumo, o preguntame algo sobre ese link.');
    return true;
  }

  const q = String(question || '').trim();

  const replyChunks = async (text) => {
    const str = String(text || '').trim();
    if (!str) return;
    for (const part of chunkString(str, 1900)) {
      await message.reply(part);
    }
  };

  try {
    await message.channel.sendTyping();
    const out = q ? await terrariaAsk(pickedUrl, q) : await terrariaSummarize(pickedUrl);
    await replyChunks(out);
  } catch (e) {
    console.error('[chatWiki] Error:', e);
    await message.reply('⚠️ no pude consultar ese link ahora mismo. probá de nuevo en unos minutos.');
  }

  return true;
}

module.exports = {
  handleChatWiki,
  extractFirstUrl,
};
