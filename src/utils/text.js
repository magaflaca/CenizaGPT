function stripDiacritics(str = '') {
  return str.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

function normalize(str = '') {
  return stripDiacritics(String(str))
    .toLowerCase()
    .replace(/[`´’']/g, '')
    .replace(/[^\p{L}\p{N}\s_-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(str = '') {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function chunkString(str, maxLen = 1900) {
  const out = [];
  let i = 0;
  while (i < str.length) {
    out.push(str.slice(i, i + maxLen));
    i += maxLen;
  }
  return out;
}


function stripControlTokens(text) {
  // Quita tokens de control usados en chat-actions (@dibujar/@editar, modelos, menciones del bot, etc.)
  let t = String(text || '');

  // menciones (ej: <@123> / <@!123>)
  t = t.replace(/<@!?\d{16,20}>/g, ' ');

  // tags
  t = t.replace(/@(?:dibujar|editar|image|imagen|vision|ver)\b/gi, ' ');

  // nombres de modelos visibles
  t = t.replace(/\b(?:fluxeniza|zeniza|ceniturbo|nanoceniza(?:\s*pro)?)\b/gi, ' ');

  // hints comunes tipo "modelo: X"
  t = t.replace(/\bmodelo\s*:\s*\w+\b/gi, ' ');

  // limpiar espacios
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

module.exports = {
  normalize,
  escapeRegExp,
  chunkString,
};