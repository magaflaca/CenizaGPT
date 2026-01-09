const { normalize } = require('../utils/text');

function scoreLine(line) {
  const t = normalize(line);
  let score = 1;
  if (!t) return 0;

  // Reglas duras
  if (t.includes('nunca') || t.includes('siempre') || t.includes('prohib') || t.includes('oblig')) score += 6;
  if (t.includes('no invent')) score += 5;
  if (t.includes('no muestres') || t.includes('no reveles') || t.includes('privad')) score += 4;

  // Comandos / features
  if (t.includes('/item') || t.includes('/config') || t.includes('/reset') || t.includes('slash')) score += 4;

  // Discord: roles/canales
  if (t.includes('rol') || t.includes('roles') || t.includes('rango') || t.includes('moder') || t.includes('admin')) score += 3;
  if (t.includes('canal') || t.includes('<#') || t.includes('#') || t.includes('discord')) score += 3;

  // Terraria
  if (t.includes('terraria') || t.includes('wiki') || t.includes('item') || t.includes('ítem') || t.includes('crafteo')) score += 3;

  // Datos tipo IP/puerto
  if (t.includes('ip') || t.includes('puerto') || t.includes('host')) score += 2;

  // Chistes y cosas de baja prioridad
  if (t.includes('iphone') || t.includes('android') || t.includes('jaja') || t.includes('xd')) score -= 1;

  return score;
}

function compileContextLines(contextLines, { maxChars = 2600, maxLines = 80 } = {}) {
  const arr = Array.isArray(contextLines) ? contextLines.map(String) : [];

  // dedupe por normalize
  const uniq = [];
  const seen = new Set();
  for (const l of arr) {
    const trimmed = String(l || '').trim();
    if (!trimmed) continue;
    const key = normalize(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(trimmed);
  }

  const scored = uniq
    .map((line) => ({ line, score: scoreLine(line) }))
    .sort((a, b) => b.score - a.score);

  const out = [];
  let chars = 0;

  for (const { line } of scored) {
    const add = `- ${line}`;
    if (out.length >= maxLines) break;
    if (chars + add.length + 1 > maxChars) continue;
    out.push(add);
    chars += add.length + 1;
  }

  const omitted = Math.max(0, uniq.length - out.length);
  if (omitted > 0) {
    out.push(`- (Contexto recortado por tamaño: ${omitted} líneas omitidas; usa /config context_list para ver el listado completo.)`);
  }

  return out.join('\n').trim();
}

module.exports = {
  compileContextLines,
};
