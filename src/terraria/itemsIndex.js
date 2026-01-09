const fs = require('fs');
const path = require('path');
const Fuse = require('fuse.js');
const { normalize } = require('../utils/text');

function extractFirstUrl(text) {
  if (!text) return null;
  const m = String(text).match(/https?:\/\/[^\s>)+]+/i);
  return m ? m[0] : null;
}

function parseItemIdFromText(text) {
  if (!text) return null;
  const raw = String(text);

  // id 123 | item 123 | ítem 123 | objeto 123 | #123
  const m1 = raw.match(/\b(?:id|item|\u00edtem|\u00edtems|item\s*id|objeto)\s*[:#-]?\s*(\d{1,5})\b/i);
  if (m1) return Number(m1[1]);

  const m2 = raw.match(/(?:^|\s)#(\d{1,5})\b/);
  if (m2) return Number(m2[1]);

  return null;
}

function parseWikiSlugFromUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    // /wiki/Foo_Bar o /es/wiki/Foo_Bar
    const parts = u.pathname.split('/').filter(Boolean);
    const idx = parts.findIndex((p) => p.toLowerCase() === 'wiki');
    if (idx >= 0 && parts[idx + 1]) {
      const slug = decodeURIComponent(parts[idx + 1]).replace(/_/g, ' ');
      return slug;
    }
  } catch (_e) {
    return null;
  }
  return null;
}

function tokenizeNormalized(textNorm) {
  return String(textNorm || '').split(' ').filter(Boolean);
}

function buildNgrams(tokens, maxN = 4) {
  const out = [];
  const nMax = Math.min(maxN, tokens.length);
  for (let n = 1; n <= nMax; n++) {
    for (let i = 0; i <= tokens.length - n; i++) {
      const phrase = tokens.slice(i, i + n).join(' ').trim();
      if (phrase.length >= 3) out.push(phrase);
    }
  }
  // Priorizar frases más largas primero
  out.sort((a, b) => b.length - a.length);
  return out;
}

class ItemsIndex {
  constructor(itemsFile) {
    this.itemsPath = path.isAbsolute(itemsFile)
      ? itemsFile
      : path.join(process.cwd(), itemsFile);

    const raw = fs.readFileSync(this.itemsPath, 'utf8');
    const items = JSON.parse(raw);
    this.items = items;

    this.byId = new Map();
    this.aliasMap = new Map(); // aliasNorm -> [item]

    for (const it of this.items) {
      it._nameNorm = normalize(it.name || '');
      it._nameEsNorm = normalize(it.name_es || '');
      it._internalNorm = normalize(it.internal_name || '');

      if (typeof it.id === 'number') {
        this.byId.set(it.id, it);
      }

      const aliases = new Set();
      if (it._nameEsNorm) aliases.add(it._nameEsNorm);
      if (it._nameNorm) aliases.add(it._nameNorm);
      if (it._internalNorm) aliases.add(it._internalNorm);

      // También indexar slugs de las URLs
      const slugEs = parseWikiSlugFromUrl(it.wiki_link_es);
      const slugEn = parseWikiSlugFromUrl(it.wiki_link);
      if (slugEs) aliases.add(normalize(slugEs));
      if (slugEn) aliases.add(normalize(slugEn));

      for (const a of aliases) {
        const arr = this.aliasMap.get(a) || [];
        arr.push(it);
        this.aliasMap.set(a, arr);
      }
    }

    this.fuse = new Fuse(this.items, {
      includeScore: true,
      ignoreLocation: true,
      threshold: 0.34,
      minMatchCharLength: 3,
      keys: [
        { name: '_nameEsNorm', weight: 0.55 },
        { name: '_nameNorm', weight: 0.40 },
        { name: '_internalNorm', weight: 0.05 },
      ],
    });
  }

  looksLikeTerrariaTopic(messageText, { channelName } = {}) {
    const textNorm = normalize(messageText);
    if (!textNorm) return false;

    const terrariaSignals = [
      'terraria', 'wiki',
      'item', 'items', '\u00edtem', 'objeto',
      'crafteo', 'craftear', 'craft', 'receta',
      'drop', 'boss', 'jefe',
      'armadura', 'arma', 'accesorio',
      'da\u00f1o', 'damage',
      'minar', 'pico', 'espada',
    ];

    const hasSignal = terrariaSignals.some((s) => textNorm.includes(normalize(s)));
    const ch = normalize(channelName || '');
    const channelSignal = Boolean(ch) && ['terraria', 'wiki', 'items', '\u00edtems', 'ayuda', 'info'].some((k) => ch.includes(k));

    return hasSignal || channelSignal;
  }

  findById(id) {
    const n = Number(id);
    if (!Number.isFinite(n)) return null;
    return this.byId.get(n) || null;
  }

  findBest(query, { strict = false } = {}) {
    const qNorm = normalize(query);
    if (!qNorm || qNorm.length < 3) return null;

    // 1) match exacto por alias
    const exactArr = this.aliasMap.get(qNorm);
    if (exactArr && exactArr.length) {
      // si hay colisiones, elegimos el primero (o el más largo)
      const pick = exactArr.slice().sort((a, b) => {
        const la = normalize(a.name_es || a.name || '').length;
        const lb = normalize(b.name_es || b.name || '').length;
        return lb - la;
      })[0];
      return { item: pick, score: 0, exact: true };
    }

    // 2) fuzzy
    const results = this.fuse.search(qNorm, { limit: 5 });
    if (!results.length) return null;

    const best = results[0];
    const score = best.score ?? 1;

    // score: 0 = exacto, 1 = nada parecido
    const threshold = strict ? 0.20 : 0.30;
    if (score > threshold) return null;

    return { item: best.item, score, exact: false };
  }

  detectItemInMessage(messageText, { channelName, allowLoose = true } = {}) {
    const text = String(messageText || '');
    const textNorm = normalize(text);
    if (!textNorm || textNorm.length < 3) return null;

    // 0) si viene un link de la wiki, intentar resolver por slug
    const url = extractFirstUrl(text);
    if (url && /terraria\./i.test(url)) {
      const slug = parseWikiSlugFromUrl(url);
      if (slug) {
        const hit = this.findBest(slug, { strict: true });
        if (hit) return { ...hit, reason: 'wiki_url' };
      }
    }

    // 1) ID explícito
    const id = parseItemIdFromText(text);
    if (id != null) {
      const it = this.findById(id);
      if (it) return { item: it, score: 0, exact: true, reason: 'id' };
    }

    // 2) generar candidatos (n-grams) y buscar el mejor
    const tokens = tokenizeNormalized(textNorm);
    const candidates = buildNgrams(tokens, 4);

    let best = null;
    for (const cand of candidates) {
      const hit = this.findBest(cand, { strict: false });
      if (!hit) continue;
      if (!best || (hit.score ?? 1) < (best.score ?? 1)) {
        best = { ...hit, phrase: cand };
        // early exit si es muy bueno
        if ((best.score ?? 1) <= 0.08) break;
      }
    }

    if (!best) return null;

    // 3) gating anti falsos positivos
    const isTerraria = this.looksLikeTerrariaTopic(text, { channelName });
    const isShort = tokens.length <= 6;
    const bestName = normalize(best.item?.name_es || best.item?.name || '');

    // Si el nombre es muy genérico/corto y no hay señales, no lo dispares
    if (!isTerraria && !isShort) {
      if (bestName.length <= 4) return null;
      if ((best.score ?? 1) > 0.18) return null;
    }

    // Si es muy largo el mensaje y no hay señales, exigir más confianza
    if (!isTerraria && tokens.length >= 10 && (best.score ?? 1) > 0.14) {
      return null;
    }

    // Si allowLoose es false, pedimos mejor score
    if (!allowLoose && (best.score ?? 1) > 0.18) return null;

    return { ...best, reason: best.exact ? 'exact' : 'fuzzy' };
  }
}

module.exports = { ItemsIndex };
