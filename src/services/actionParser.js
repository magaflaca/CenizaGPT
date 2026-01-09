const { chatCompletion } = require('./groqClients');
const { normalize } = require('../utils/text');

const KICK_WORDS = ['expulsa', 'expulsar', 'kick', 'echa', 'echar', 'saca', 'sacar'];
const BAN_WORDS = ['banea', 'banear', 'ban', 'permaban'];
const TIMEOUT_WORDS = ['silencia', 'silenciar', 'mute', 'timeout', 'time out', 'castiga', 'calla'];
const UNTIMEOUT_WORDS = ['desmute', 'unmute', 'quita el mute', 'quita el silencio', 'quita el timeout', 'remueve el mute', 'desilencia'];

const NICK_WORDS = ['apodo', 'nickname', 'nick'];
const ROLE_WORDS = ['rol', 'roles', 'rango', 'ranks'];

const ROLE_VERBS = ['pon', 'ponle', 'asigna', 'dale', 'da', 'quita', 'quitar', 'quitala', 'quitarle', 'remove', 'remueve', 'saca', 'sube', 'subir', 'promueve', 'promover', 'baja', 'cambia', 'cambiar'];
const NICK_VERBS = ['pon', 'ponle', 'cambia', 'cambiar', 'set'];

function includesAny(normText, words) {
  return words.some((w) => normText.includes(normalize(w)));
}

function looksLikeActionRequest(text) {
  const t = normalize(text);
  if (!t) return false;

  if (includesAny(t, KICK_WORDS)) return true;
  if (includesAny(t, BAN_WORDS)) return true;
  if (includesAny(t, TIMEOUT_WORDS)) return true;

  // Nickname: requiere verbo + palabra clave
  if (includesAny(t, NICK_WORDS) && includesAny(t, NICK_VERBS)) return true;

  // Roles: evita falsos positivos tipo "¿qué roles hay?"
  if (includesAny(t, ROLE_WORDS) && includesAny(t, ROLE_VERBS)) return true;

  return false;
}

function extractFirstUserMention(text) {
  const m = String(text || '').match(/<@!?([0-9]{16,20})>/);
  return m ? m[1] : null;
}

function extractFirstRoleMention(text) {
  const m = String(text || '').match(/<@&([0-9]{16,20})>/);
  return m ? m[1] : null;
}

function extractLooseId(text) {
  const m = String(text || '').match(/\b\d{16,20}\b/);
  return m ? m[0] : null;
}

function extractQuoted(text) {
  const m = String(text || '').match(/"([^\n\r"]{1,80})"/);
  return m ? m[1] : null;
}

function parseDurationMs(text) {
  const raw = String(text || '');

  // 10m, 2h, 1d, 30s, 2w
  const m1 = raw.match(/\b(\d{1,4})\s*(s|seg|segs|sec|secs|segundo|segundos|m|min|mins|minuto|minutos|h|hr|hrs|hora|horas|d|dia|día|dias|días|w|sem|semanas?)\b/i);
  if (m1) {
    const n = Number(m1[1]);
    const unit = normalize(m1[2]);
    if (!Number.isFinite(n) || n <= 0) return null;

    const sec = ['s', 'seg', 'segs', 'sec', 'secs', 'segundo', 'segundos'];
    const min = ['m', 'min', 'mins', 'minuto', 'minutos'];
    const hr = ['h', 'hr', 'hrs', 'hora', 'horas'];
    const day = ['d', 'dia', 'día', 'dias', 'días'];
    const week = ['w', 'sem', 'semana', 'semanas'];

    if (sec.includes(unit)) return n * 1000;
    if (min.includes(unit)) return n * 60 * 1000;
    if (hr.includes(unit)) return n * 60 * 60 * 1000;
    if (day.includes(unit)) return n * 24 * 60 * 60 * 1000;
    if (week.includes(unit)) return n * 7 * 24 * 60 * 60 * 1000;
  }

  // "por 10" (asumir minutos) - solo si hay palabra clave de tiempo
  const m2 = raw.match(/\bpor\s+(\d{1,4})\b/i);
  if (m2 && /min|hora|día|dia|seg/i.test(raw)) {
    // ya lo capturamos arriba normalmente, pero por si acaso
  }

  return null;
}

function tryRuleBasedParse(text, { defaultTargetUserId = null } = {}) {
  const t = normalize(text);
  const targetUserId = extractFirstUserMention(text) || extractLooseId(text) || defaultTargetUserId;
  const roleId = extractFirstRoleMention(text) || null;

  // Kick
  if (includesAny(t, KICK_WORDS)) {
    if (!targetUserId) return { ok: false, error: 'Falta mencionar al usuario objetivo (o responder a su mensaje).' };
    return { ok: true, action: { type: 'kick', targetUser: targetUserId, reason: '' } };
  }

  // Ban
  if (includesAny(t, BAN_WORDS) && !t.includes('bandera')) {
    if (!targetUserId) return { ok: false, error: 'Falta mencionar al usuario objetivo (o responder a su mensaje).' };
    return { ok: true, action: { type: 'ban', targetUser: targetUserId, reason: '' } };
  }

  // Timeout / mute
  if (includesAny(t, TIMEOUT_WORDS) || includesAny(t, UNTIMEOUT_WORDS)) {
    if (!targetUserId) return { ok: false, error: 'Falta mencionar al usuario objetivo (o responder a su mensaje).' };

    const isRemove = includesAny(t, UNTIMEOUT_WORDS) || t.includes('unmute') || t.includes('desmute');
    if (isRemove) {
      return { ok: true, action: { type: 'timeout', targetUser: targetUserId, durationMs: 0, reason: '' } };
    }

    const durationMs = parseDurationMs(text);
    if (!durationMs) {
      return { ok: false, error: 'Para silenciar necesito una duración. Ej: "mutea 10m" / "silencia 1h".' };
    }

    return { ok: true, action: { type: 'timeout', targetUser: targetUserId, durationMs, reason: '' } };
  }

  // Nickname
  if (includesAny(t, NICK_WORDS) && includesAny(t, NICK_VERBS)) {
    if (!targetUserId) return { ok: false, error: 'Falta mencionar al usuario objetivo (o responder a su mensaje).' };
    const q = extractQuoted(text);
    if (!q) return { ok: false, error: 'Falta el nuevo apodo entre comillas, ej: "Nuevo Apodo".' };
    return { ok: true, action: { type: 'nickname_set', targetUser: targetUserId, newNickname: q.slice(0, 32), reason: '' } };
  }

  // Roles
  if (includesAny(t, ROLE_WORDS) && includesAny(t, ROLE_VERBS)) {
    if (!targetUserId) return { ok: false, error: 'Falta mencionar al usuario objetivo (o responder a su mensaje).' };

    // rol por mención o por comillas o por texto después de "a"
    let roleRaw = roleId;
    if (!roleRaw) {
      const q = extractQuoted(text);
      if (q) roleRaw = q;
    }
    if (!roleRaw) {
      // intentar extraer algo luego de "a" o "por"
      const m = String(text).match(/\b(?:a|por)\s+([^\n\r]{2,40})$/i);
      if (m) roleRaw = m[1].trim();
    }

    if (!roleRaw) return { ok: false, error: 'Falta el rol. Puedes mencionarlo (<@&rol>) o ponerlo entre comillas.' };

    const isRemove = t.includes('quita') || t.includes('quitar') || t.includes('remove') || t.includes('remueve') || t.includes('saca') || t.includes('baja');

    return {
      ok: true,
      action: {
        type: isRemove ? 'role_remove' : 'role_add',
        targetUser: targetUserId,
        role: roleRaw,
        reason: '',
      },
    };
  }

  return { ok: false, error: 'No pude parsear la acción por reglas.' };
}

async function parseActionWithLLM({ groqClient, model, text, speaker, guild, defaultTargetUserId = null, repliedSummary = null }) {
  const system = [
    'Eres un parser estricto. Devuelves SOLO JSON válido. Sin markdown.',
    'Tu trabajo: detectar si el usuario está pidiendo una acción administrativa de Discord.',
    'Acciones permitidas:',
    '- kick',
    '- ban',
    '- timeout (silenciar/timeout; duration_ms=0 para quitar timeout)',
    '- nickname_set',
    '- role_add',
    '- role_remove',
    'Si falta información crítica o no estás seguro, devuelve kind="NONE".',
    '',
    'Esquema:',
    '{"kind":"ACTION"|"NONE", "action": {"type":..., "target":"<@id>|id|texto", "role":"<@&id>|id|texto", "new_nickname":"texto", "duration_ms":123, "reason":"texto"}}',
    '',
    'Notas:',
    '- target puede omitirse SOLO si existe default_target_user_id y la frase dice "este usuario" o similar.',
    '- role solo para role_add/role_remove.',
    '- new_nickname solo para nickname_set.',
    '- duration_ms solo para timeout.',
  ].join('\n');

  const user = [
    `Servidor: ${guild?.name || 'desconocido'}`,
    `Solicitante: id=${speaker?.id || '??'} apodo="${speaker?.displayName || '??'}" admin=${speaker?.isAdmin ? 'sí' : 'no'}`,
    defaultTargetUserId ? `default_target_user_id: ${defaultTargetUserId}` : 'default_target_user_id: (none)',
    repliedSummary ? `Mensaje respondido: ${repliedSummary}` : 'Mensaje respondido: (none)',
    'Mensaje:',
    text,
  ].join('\n');

  const raw = await chatCompletion({
    client: groqClient,
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0,
    maxTokens: 260,
  });

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_e) {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('El LLM no devolvió JSON válido.');
    parsed = JSON.parse(m[0]);
  }

  if (!parsed || parsed.kind !== 'ACTION') return { kind: 'NONE' };
  return parsed;
}

module.exports = {
  looksLikeActionRequest,
  tryRuleBasedParse,
  parseActionWithLLM,
  parseDurationMs,
};
