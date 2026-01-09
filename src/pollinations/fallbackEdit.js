// src/pollinations/fallbackEdit.js
const { imageDescribe } = require('../vision/imageBridge');
const { generateImage } = require('./pollinationsBridge');
const { normalize } = require('../utils/text');

function pickFallbackModelId(text, fallbackModelId = null) {
  // Si ya te pasaron uno (desde chat), úsalo
  if (fallbackModelId && typeof fallbackModelId === 'string') {
    const id = fallbackModelId.toLowerCase();
    if (id === 'flux' || id === 'zimage' || id === 'turbo') return id;
  }

  const t = normalize(text || '');

  if (t.includes('ceniturbo') || t.includes('turbo')) return 'turbo';
  if (t.includes('zeniza') || t.includes('zimage')) return 'zimage';
  if (t.includes('fluxeniza') || t.includes('flux')) return 'flux';

  // default estable
  return 'turbo';
}

async function fallbackEditToGenerate({
  imageUrl,
  userEditPrompt,
  modelId = null,
  seed = 0,
  width = 1024,
  height = 1024,
  describeFn = null,
  generateFn = null,
}) {
  const gen = generateFn || generateImage;
  const describe = describeFn || imageDescribe;

  const fallbackModel = pickFallbackModelId(userEditPrompt, modelId);

  // 1) describir la imagen (breve, útil)
  let desc = '';
  try {
    desc = await describe(imageUrl, 'Describe la imagen de forma breve y útil para recrearla. No inventes texto.');
  } catch (_) {
    desc = '';
  }

  const base = desc && String(desc).trim()
    ? `Descripción de la imagen original: ${String(desc).trim()}`
    : `Descripción de la imagen original: (no disponible).`;

  // 2) prompt final
  const finalPrompt = [
    base,
    '',
    `Edición solicitada: ${String(userEditPrompt || '').trim()}`,
    '',
    'Genera una nueva imagen aplicando la edición solicitada.',
  ].join('\n').trim();

  // 3) generar imagen fallback
  const out = await gen({
    prompt: finalPrompt,
    modelId: fallbackModel,
    seed: seed || 0,
    width: width || 1024,
    height: height || 1024,
  });

  // out debe ser { ok:true, buffer:Buffer, seed,... } con tu bridge actual
  if (!out || !out.ok || !out.buffer) {
    return { ok: false, error: 'fallback_generate_invalid' };
  }

  return {
    ok: true,
    buffer: out.buffer,
    seed: out.seed ?? seed ?? 0,
    model: fallbackModel,
    prompt_used: finalPrompt,
  };
}

module.exports = { fallbackEditToGenerate };
