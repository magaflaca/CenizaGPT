const { normalize } = require('../utils/text');
const { chatCompletion } = require('./groqClients');

function includesAny(t, list) {
  return list.some((w) => t.includes(normalize(w)));
}

function detectTask(cleanText) {
  const t = normalize(cleanText);
  if (!t) return null;

  // Pedidos típicos sobre el mensaje respondido
  if (includesAny(t, ['resume', 'resumen', 'resúmeme', 'resumeme', 'tl;dr', 'mucho texto', 'muy largo'])) return 'SUMMARY';
  if (includesAny(t, ['explica', 'explicame', 'explícame', 'que significa', 'qué significa', 'que quiso decir', 'qué quiso decir'])) return 'EXPLAIN';
  if (includesAny(t, ['contesta', 'respond', 'responde', 'responda', 'responder', 'respondele', 'respóndele'])) return 'ANSWER';
  if (includesAny(t, ['de que habla', 'de qué habla', 'que esta hablando', 'qué está hablando', 'tema'])) return 'TOPIC';
  if (includesAny(t, ['cita', 'cítame', 'citalo', 'cítalo', 'texto exacto', 'literal', 'tal cual', 'como dice', 'cómo dice'])) return 'QUOTE';

  // Si el usuario dice “este mensaje”/“ese mensaje”, asumimos que quiere ayuda sobre el reply
  if (includesAny(t, ['este mensaje', 'ese mensaje', 'este otro mensaje', 'el mensaje de arriba', 'el mensaje anterior'])) {
    return 'SUMMARY';
  }

  return null;
}

function trimForModel(text, maxLen = 1600) {
  const s = String(text || '').trim();
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + '\n…(recortado)';
}

function buildSystemPrompt() {
  return [
    'Eres CenizaGPT (Discord). El usuario te pide ayudar con un mensaje específico (normalmente el que está respondiendo).',
    '',
    'Reglas:',
    '- Responde DIRECTO al usuario. No digas cosas como "el usuario te pidió" ni repitas instrucciones internas.',
    '- Usa un estilo cercano, en minúsculas, y breve si es posible.',
    '- NO inventes contenido que no esté en el mensaje original.',
    '- Si te piden una cita literal y no tienes el texto exacto, dilo claramente.',
    '- Si el mensaje original es muy largo o incompleto, avisa y resume lo que sí ves.',
  ].join('\n');
}

function buildUserPrompt({ task, userRequest, repliedAuthor, repliedContent }) {
  const taskLine = {
    SUMMARY: 'haz un resumen corto (3-7 líneas).',
    EXPLAIN: 'explica de forma simple lo que significa.',
    ANSWER: 'responde a la pregunta/contenido del mensaje como si fueras el bot, breve.',
    TOPIC: 'di de qué trata el mensaje en 1-2 líneas.',
    QUOTE: 'devuelve la frase o parte relevante tal cual (si está presente). si no está, dilo.',
  }[task] || 'ayuda con el mensaje.';

  return [
    `tarea: ${taskLine}`,
    '',
    `pedido del usuario: ${trimForModel(userRequest, 500)}`,
    '',
    `mensaje original (autor: ${repliedAuthor || 'desconocido'}):`,
    trimForModel(repliedContent, 1800),
  ].join('\n');
}

async function maybeHandleReplyAssist({ message, ctx, cleanText, speaker, repliedMessage, forcedTask = null }) {
  const t = normalize(cleanText);
  if (!t) return false;

  const task = forcedTask || detectTask(cleanText);
  if (!task) return false;

  let repliedAuthor = null;
  let repliedContent = null;

  // 1) Si hay reply real, usamos eso
  if (repliedMessage) {
    repliedAuthor = repliedMessage.member?.displayName || repliedMessage.author?.username || null;
    // Si el mensaje original tiene embeds/attachments y no texto, dejamos una pista
    const baseText = String(repliedMessage.content || '').trim();
    const hasAttach = (repliedMessage.attachments?.size || 0) > 0;
    const hasEmbed = (repliedMessage.embeds?.length || 0) > 0;
    if (baseText) {
      repliedContent = baseText;
    } else if (hasAttach || hasEmbed) {
      repliedContent = '(mensaje sin texto o con adjuntos/embeds)';
    } else {
      repliedContent = '(mensaje vacío)';
    }

    // Guardar para follow-ups
    if (message.guild) {
      ctx.memoryStore.setUserState({
        guildId: message.guild.id,
        userId: message.author.id,
        patch: {
          lastReplyContext: {
            author: repliedAuthor,
            content: repliedContent,
            ts: Date.now(),
          },
        },
      });
    }
  } else if (message.guild) {
    // 2) Si no hay reply, intentamos usar el último contexto guardado del usuario
    const state = ctx.memoryStore.getUserState({ guildId: message.guild.id, userId: message.author.id }) || {};
    const last = state.lastReplyContext;
    if (last && last.content && (Date.now() - (last.ts || 0) < 10 * 60 * 1000)) {
      repliedAuthor = last.author || null;
      repliedContent = last.content || null;
    }
  }

  if (!repliedContent) {
    await message.reply('respondeme a un mensaje (reply) y decime qué querés que haga con ese mensaje.');
    return true;
  }

  try {
    await message.channel.sendTyping();

    const raw = await chatCompletion({
      client: ctx.groqNormal,
      model: ctx.models.normal,
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user', content: buildUserPrompt({
          task,
          userRequest: cleanText,
          repliedAuthor,
          repliedContent,
        }) },
      ],
      temperature: 0.35,
      maxTokens: 250,
    });

    const out = String(raw || '').trim();
    if (!out) {
      await message.reply('no pude generar una respuesta ahora mismo.');
      return true;
    }

    // Responder directo, sin meta
    await message.reply(out.slice(0, 1900));
    return true;
  } catch (e) {
    console.error('[replyAssist] Error:', e);
    await message.reply('no pude procesar ese mensaje ahora mismo. probá de nuevo en un rato.');
    return true;
  }
}

module.exports = { maybeHandleReplyAssist };
