const { normalize } = require('../utils/text');

function clamp(n, a, b) {
  const x = Number(n);
  if (!Number.isFinite(x)) return a;
  return Math.max(a, Math.min(b, x));
}

function extractSeedFromText(text) {
  const t = String(text || '').toLowerCase();
  // seed 123 / seed:123 / --seed 123 / semilla 123
  const m = t.match(/\b(?:seed|semilla)\s*[:=]?\s*(\d{1,10})\b/);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) ? v : null;
}

function extractSizeFromText(text) {
  const raw = String(text || '');
  const t = raw.toLowerCase();

  // 1024x1024 / 768x1024 etc
  const m = t.match(/\b(\d{3,4})\s*[x×]\s*(\d{3,4})\b/);
  if (m) {
    const w = Number(m[1]);
    const h = Number(m[2]);
    if (
      Number.isFinite(w) && Number.isFinite(h) &&
      w >= 256 && h >= 256 &&
      w <= 2048 && h <= 2048
    ) {
      return { w, h };
    }
  }

  // keywords comunes
  if (t.includes('cuadrad')) return { w: 1024, h: 1024 };
  if (t.includes('vertical') || t.includes('retrato') || t.includes('portrait')) return { w: 768, h: 1024 };
  if (t.includes('horizontal') || t.includes('paisaje') || t.includes('landscape')) return { w: 1024, h: 768 };

  // 1:1 / 16:9 / 9:16
  if (t.includes('1:1')) return { w: 1024, h: 1024 };
  if (t.includes('16:9')) return { w: 1024, h: 576 };
  if (t.includes('9:16')) return { w: 576, h: 1024 };

  return null;
}

/**
 * Devuelve el ID interno usado por pollinationsBridge:
 * - flux
 * - zimage
 * - turbo
 * - nanobanana
 *
 * O null si no detecta nada.
 */
function extractModelIdFromText(text) {
  const t = normalize(text);
  if (!t) return null;

  // nanobanana / nanoceniza
  if (t.includes('nanobanana') || t.includes('nanoceniza')) return 'nanobanana';

  // turbo / ceniturbo
  if (t.includes('ceniturbo') || t.includes('turbo')) return 'turbo';

  // zimage / zeniza
  if (t.includes('zimage') || t.includes('zeniza') || t.includes('zimg')) return 'zimage';

  // flux / fluxeniza
  if (t.includes('fluxeniza') || t.includes('flux')) return 'flux';

  return null;
}

/**
 * Limpia tokens “de control” que NO deberían entrar al prompt visual.
 * Esto evita que el modelo “dibuje” cosas como "@dibujar 1024x1024 seed 12 turbo".
 */
function stripControlTokens(input) {
  let s = String(input || '');

  // quitar menciones discord <@...> y <@!...>
  s = s.replace(/<@!?\d{16,20}>/g, ' ');

  // quitar triggers típicos de chat
  s = s.replace(/\B@dibujar\b/gi, ' ');
  s = s.replace(/\B@editar\b/gi, ' ');
  s = s.replace(/\bdibujar\b/gi, ' ');
  s = s.replace(/\beditar\b/gi, ' ');

  // quitar nombres de modelos
  s = s.replace(
    /\b(ceniturbo|zeniza|fluxeniza|nanoceniza\s*pro|nanoceniza|nanobanana|zimage|flux|turbo)\b/gi,
    ' '
  );

  // quitar flags estilo CLI
  s = s.replace(/--?(seed|semilla|width|height|w|h)\s*[=:]?\s*\d{1,10}/gi, ' ');
  s = s.replace(/\b(\d{3,4})\s*[x×]\s*(\d{3,4})\b/g, ' ');
  s = s.replace(/\b(seed|semilla)\s*[:=]?\s*\d{1,10}\b/gi, ' ');

  // limpieza final
  s = s.replace(/\s{2,}/g, ' ').trim();
  return s;
}

/**
 * API nueva (opcional) – la dejo para compatibilidad con otros módulos.
 */
function parseDrawPrompt(cleanText, { defaultModel = 'flux', defaultSize = { w: 1024, h: 1024 } } = {}) {
  const raw = String(cleanText || '').trim();

  const modelId = extractModelIdFromText(raw) || defaultModel;
  const size = extractSizeFromText(raw) || defaultSize;
  const seed = extractSeedFromText(raw);

  const prompt = stripControlTokens(raw);

  return {
    ok: Boolean(prompt),
    prompt: prompt || '',
    modelId,
    width: clamp(size.w, 256, 2048),
    height: clamp(size.h, 256, 2048),
    seed: Number.isFinite(seed) ? seed : 0,
  };
}

function parseEditPrompt(cleanText) {
  const raw = String(cleanText || '').trim();
  const seed = extractSeedFromText(raw);
  const prompt = stripControlTokens(raw);

  return {
    ok: Boolean(prompt),
    prompt: prompt || '',
    seed: Number.isFinite(seed) ? seed : 0,
  };
}

module.exports = {
  // compat con tu chatImageActions.js actual
  extractModelIdFromText,
  extractSizeFromText,
  extractSeedFromText,
  stripControlTokens,

  // API “nueva”
  parseDrawPrompt,
  parseEditPrompt,
};
