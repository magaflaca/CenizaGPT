// src/vision/imageMentionHandler.js
// Mention-based image handling (visión) for chat.
//
// Filosofía v3.8:
// - Cero heurísticas de "modo" (describe/ocr/ask) en el lado JS.
// - Le pasamos la instrucción del usuario al LLM de visión y que él decida:
//   describir, leer texto, responder preguntas, resumir, etc.
// - Se activa sólo cuando el router decide VISION, o cuando force=true.

const { imageDescribe } = require('./imageBridge');
const { pickImageFromMessage, extractFirstUrlFromText } = require('./imageSource');

async function maybeHandleImageMention({ message, clientUserId, prompt = '', force = false }) {
  // Si no estamos forzando, requiere mención directa
  if (!force) {
    if (!message.mentions?.users?.has?.(clientUserId)) return false;
  }

  // Fuente de imagen:
  // 1) adjunto en el mensaje actual
  // 2) si responde a un mensaje con adjunto
  // 3) URL en el texto
  let src = pickImageFromMessage(message) || extractFirstUrlFromText(message.content);

  let replied = null;
  if (!src && message.reference?.messageId) {
    replied = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
    src = pickImageFromMessage(replied);
  }

  if (!src) return false;

  // Instrucción del usuario: si no hay, pedimos una descripción breve.
  const userPrompt = String(prompt || '').trim() || 'describe la imagen brevemente y en español.';

  try {
    let out = await imageDescribe(src, userPrompt);
    if (out.length > 1800) out = out.slice(0, 1800) + '\n\n…(recortado)';
    await message.reply(out);
    return true;
  } catch (e) {
    console.error('[imageMention] Error:', e);
    await message.reply('No pude analizar esa imagen ahora mismo.');
    return true;
  }
}

module.exports = { maybeHandleImageMention };
