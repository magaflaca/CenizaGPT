// src/terraria/linkify.js
const { normalize } = require('../utils/text');

// 1) Display SIEMPRE texto plano (sin markdown)
function pickDisplayName(item, { preferSpanish = true } = {}) {
  const raw =
    (preferSpanish && item?.name_es) ? item.name_es :
    (item?.name_es || item?.name || item?.internal_name || '');

  // Quitar cualquier markdown accidental
  return String(raw)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // convierte [text](url) -> text
    .replace(/[<>]/g, '')                   // elimina < >
    .trim();
}

// 2) URL SOLO desde campos del item (nunca desde display)
function pickWikiLink(item, { preferSpanish = true } = {}) {
  const url =
    (preferSpanish && item?.wiki_link_es) ? item.wiki_link_es :
    (item?.wiki_link_es || item?.wiki_link || '');

  // Sanity: si no parece URL válida, no inventamos
  if (!url || typeof url !== 'string') return null;
  if (!/^https?:\/\/.+/i.test(url)) return null;
  return url;
}

// util: evita reemplazar dentro de markdown links existentes
function isInsideMarkdownLink(text, index) {
  // detecta si el índice cae dentro de un patrón [..](..)
  // aproximación: si hay un '[' antes y un ')' después sin cerrar
  const left = text.lastIndexOf('[', index);
  const mid = text.lastIndexOf('](', index);
  const right = text.indexOf(')', index);
  if (left === -1 || mid === -1 || right === -1) return false;
  return left < mid && index < right;
}

// 3) Linkify seguro: no anida links, no toca ya-linkificados, y respeta word boundaries
function linkifyTextWithItem(text, item, { preferSpanish = true } = {}) {
  const url = pickWikiLink(item, { preferSpanish });
  const display = pickDisplayName(item, { preferSpanish });
  if (!url || !display) return String(text || '');

  let out = String(text || '');

  // Si ya está linkificado correctamente, no tocar
  const already = new RegExp(`\\[\\s*${escapeRegExp(display)}\\s*\\]\\(<\\s*${escapeRegExp(url)}\\s*>\\)`, 'i');
  if (already.test(out)) return out;

  // Reemplazo por ocurrencias “limpias” del display con límites de palabra
  // Evita reemplazar si el match cae dentro de un link ya existente
  const re = new RegExp(`\\b${escapeRegExp(display)}\\b`, 'gi');

  out = out.replace(re, (m, offset) => {
    if (isInsideMarkdownLink(out, offset)) return m;
    return `[${m}](<${url}>)`;
  });

  return out;
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  pickDisplayName,
  pickWikiLink,
  linkifyTextWithItem,
};
