const LABEL_WHITELIST = new Set([
  'IP',
  'PUERTO',
  'REGLAS',
  'OBJETIVO',
  'RESPUESTA',
  'IMPORTANTE',
  'NOTA',
  'NOTAS',
  'TIP',
  'TIPS',
  'PD',
  'P.D',
]);

function stripLeadingUsernamePrefix(text) {
  if (!text) return text;
  const lines = String(text).split(/\r?\n/);
  const out = lines.map((line) => {
    const m = line.match(/^\s*([A-Za-z0-9_]{2,32}):\s+(.*)$/);
    if (!m) return line;
    const prefix = m[1];
    const rest = m[2];
    const upper = prefix.toUpperCase();
    if (LABEL_WHITELIST.has(upper)) return line;
    // Si es un label muy corto en mayúsculas, lo dejamos
    if (prefix.length <= 3 && prefix === upper) return line;
    return rest;
  });
  return out.join('\n').trim();
}

function sanitizeBotResponse(text) {
  let t = String(text || '');
  t = stripLeadingUsernamePrefix(t);
  // Evitar respuestas vacías
  if (!t.trim()) t = 'Listo.';
  return t;
}

module.exports = { sanitizeBotResponse };
