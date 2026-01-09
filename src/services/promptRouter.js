const { chatCompletion } = require('./groqClients');
const { compileContextLines } = require('./contextCompiler');

/**
 * Router LLM: decide qué subsistema debe actuar.
 *
 * Importante:
 * - Debe devolver SOLO JSON válido.
 * - No debe "adivinar" datos externos.
 */

const ROUTES = [
  'CHAT',
  'RESET',
  'SERVER',
  'MOD_ACTION',
  'REPLY_ASSIST',
  'VISION',
  'DRAW',
  'EDIT',
  'ITEM',
  'WIKI',
];

const SERVER_INTENTS = [
  'CHANNEL_LIST',
  'RULES_WHERE',
  'SERVER_SUMMARY',
  'CHANNEL_PURPOSE',
  'USER_INFO',
  'ROLES_LIST',
  'ROLE_STRUCTURE',
  'OWNER',
];

function safeJsonStringify(obj, maxLen = 1800) {
  let s = '';
  try {
    s = JSON.stringify(obj || {}, null, 2);
  } catch {
    s = String(obj || '');
  }
  if (s.length > maxLen) s = s.slice(0, maxLen) + '\n…(recortado)';
  return s;
}

function toContextLineArray(maybeStringOrArray) {
  // compileContextLines() en tu proyecto devuelve un string (no array).
  if (Array.isArray(maybeStringOrArray)) {
    return maybeStringOrArray.map((x) => String(x || '').trim()).filter(Boolean);
  }

  const s = String(maybeStringOrArray || '').trim();
  if (!s) return [];

  // Si ya viene con "- " al inicio de cada línea, lo limpiamos.
  return s
    .split('\n')
    .map((l) => String(l || '').trim())
    .filter(Boolean)
    .map((l) => (l.startsWith('- ') ? l.slice(2).trim() : l));
}

function buildRouterSystemPrompt({ config }) {
  // OJO: config.context suele ser array.
  const compiled = compileContextLines(config?.context || []);
  const contextLines = toContextLineArray(compiled);

  return [
    'Eres un ROUTER de un bot de Discord (CenizaGPT). Tu único trabajo es decidir qué subsistema debe actuar.',
    '',
    'DEVUELVE **SOLO JSON** válido, sin texto adicional, sin markdown.',
    '',
    `RUTAS POSIBLES: ${ROUTES.join(', ')}`,
    '',
    'DESCRIPCIÓN RÁPIDA DE RUTAS:',
    '- CHAT: conversación normal / dudas generales.',
    '- RESET: olvidar historial reciente del chat (sin tocar serverConfig).',
    '- SERVER: preguntas del servidor (canales, reglas, roles, estructura, dueño, info de un usuario).',
    '- MOD_ACTION: acciones de moderación/administración (kick/ban/mute/roles/apodos) => requiere confirmación.',
    '- REPLY_ASSIST: el usuario pide resumir/explicar/contestar un mensaje al que está respondiendo (o "ese mensaje").',
    '- VISION: análisis de imagen (describir / leer texto / responder preguntas sobre imagen).',
    '- DRAW: generar una imagen (flux/zimage/turbo).',
    '- EDIT: editar una imagen existente (idealmente reply a imagen o URL).',
    '- ITEM: consultas de ítems de Terraria (wiki/items.json).',
    '- WIKI: resumir o responder preguntas sobre una URL/web (no inventar; si falta acceso, decirlo).',
    '',
    'IMPORTANTE (anti-fallos):',
    '- NO elijas VISION solo porque hay una imagen. Elige VISION SOLO si el usuario pide describir/leer/analizar la imagen.',
    '- Si el texto es MUY corto o vago (ej: "?", "que dices", "xd") y no contiene un pedido claro, elige CHAT.',
    '- Si el usuario pide EDITAR una imagen ("edita", "cambia", "pon", "quita" en una imagen), elige EDIT (no VISION).',
    '- Si el usuario pide GENERAR una imagen ("dibuja", "genera", "haz una imagen"), elige DRAW.',
    '- Para Terraria: SOLO usa ITEM si el usuario pregunta por un ítem específico o hay una pista fuerte de ítem. Si habla de Terraria pero no es un ítem, NO inventes: usa CHAT y sugiere /item.',
    '- Para SERVER->USER_INFO: elige USER_INFO solo si hay objetivo (mención/ID/nick claro, o reply a su mensaje). Si no, usa CHAT o SERVER con otro intent.',
    '- Si hay una URL y el usuario pide resumen/pregunta sobre esa página, elige WIKI.',
    '',
    'ESTRUCTURA JSON DE RESPUESTA:',
    '{',
    '  "route": "CHAT" | ... ,',
    '  "reason": "breve",',
    '  "server_intent": (solo si route==SERVER) uno de: ' + SERVER_INTENTS.join(', '),
    '  "args": { ... } // opcional según ruta',
    '}',
    '',
    'Para DRAW, args soporta:',
    '{ "prompt": "...", "model": "fluxeniza"|"zeniza"|"ceniturbo"|"auto", "width": 1024, "height": 1024, "seed": 0 }',
    '',
    'Para EDIT, args soporta:',
    '{ "prompt": "...", "image_source": "reply"|"url"|"attachment"|"unknown", "image_url": "(si aplica)", "seed": 0 }',
    '',
    'Para ITEM, args soporta:',
    '{ "item_query": "...", "question": "(opcional)", "mode": "info"|"ask"|"auto" }',
    '',
    'Para WIKI, args soporta:',
    '{ "url": "...", "question": "(opcional)" }',
    '',
    'CONTEXTO DEL SERVER (serverConfig.json) - úsalo para decidir rutas y para saber reglas/canales:',
    ...(contextLines.length ? contextLines.map((l) => `- ${l}`) : ['- (sin contexto configurado)']),
    '',
    'Recuerda: SOLO JSON. No comentes. No expliques fuera del campo reason.',
  ].join('\n');
}

function buildRouterUserPrompt({ text, meta }) {
  const metaStr = safeJsonStringify(meta, 2000);
  return [
    'MENSAJE_DEL_USUARIO:',
    String(text || '').slice(0, 2000),
    '',
    'META (datos del evento de Discord / contexto mínimo):',
    metaStr,
  ].join('\n');
}

async function routePrompt({ groqClient, model, config, text, meta, maxTokens = 220 }) {
  const systemPrompt = buildRouterSystemPrompt({ config });
  const userPrompt = buildRouterUserPrompt({ text, meta });

  const raw = await chatCompletion({
    client: groqClient,
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.05,
    maxTokens,
  });

  let parsed = null;
  try {
    parsed = JSON.parse(String(raw || '').trim());
  } catch (_e) {
    // intento recuperar JSON si el modelo metió texto extra
    const m = String(raw || '').match(/\{[\s\S]*\}/);
    if (m) {
      try {
        parsed = JSON.parse(m[0]);
      } catch (_e2) {
        parsed = null;
      }
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    return { route: 'CHAT', reason: 'router_invalid_json' };
  }

  const route = String(parsed.route || 'CHAT').toUpperCase();
  if (!ROUTES.includes(route)) {
    return { route: 'CHAT', reason: 'router_unknown_route' };
  }

  const out = {
    route,
    reason: String(parsed.reason || '').slice(0, 180),
  };

  if (route === 'SERVER') {
    const si = String(parsed.server_intent || '').toUpperCase();
    out.server_intent = SERVER_INTENTS.includes(si) ? si : null;
    out.args = (parsed.args && typeof parsed.args === 'object') ? parsed.args : {};
  } else if (parsed.args && typeof parsed.args === 'object') {
    out.args = parsed.args;
  }

  return out;
}

module.exports = { routePrompt };
