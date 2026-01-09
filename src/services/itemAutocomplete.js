// src/services/itemAutocomplete.js
const { normalize } = require('../utils/text');

function displayName(item) {
  return String(item?.name_es || item?.name || 'Item').trim();
}

function clampChoiceName(s) {
  // Discord: choice name máx 100 chars
  const out = String(s || '').replace(/\s+/g, ' ').trim();
  return out.length > 100 ? out.slice(0, 97) + '...' : out;
}

function buildChoicesFromItems(items) {
  const out = [];
  const seen = new Set();
  for (const it of items) {
    if (!it || it.id == null) continue;
    const id = String(it.id);
    if (seen.has(id)) continue;
    seen.add(id);

    const name = clampChoiceName(`${displayName(it)} [ID: ${id}]`);
    out.push({ name, value: id }); // ✅ value = ID para que sea exacto
    if (out.length >= 25) break;
  }
  return out;
}

function getDefaultChoices(itemsIndex) {
  // lista inicial: ordenada por español (rápido y estable)
  const items = (itemsIndex.items || [])
    .slice()
    .sort((a, b) => displayName(a).localeCompare(displayName(b), 'es'));
  return buildChoicesFromItems(items.slice(0, 25));
}

function searchChoices(itemsIndex, queryRaw) {
  const q = String(queryRaw || '').trim();
  const qNorm = normalize(q);

  if (!qNorm) return getDefaultChoices(itemsIndex);

  // Si escribió un ID, sugerimos ese primero
  const idMatch = qNorm.match(/^\d{1,5}$/);
  const picks = [];

  if (idMatch) {
    const byId = itemsIndex.findById(Number(qNorm));
    if (byId) picks.push(byId);
  }

  // Fuse (ya existe en itemsIndex): tolera typos, inglés, etc.
  if (qNorm.length >= 2 && itemsIndex.fuse?.search) {
    const results = itemsIndex.fuse.search(qNorm, { limit: 25 });
    for (const r of results) {
      if (r?.item) picks.push(r.item);
    }
  }

  // fallback extra: si quedó vacío
  if (!picks.length) return getDefaultChoices(itemsIndex);

  return buildChoicesFromItems(picks);
}

async function handleItemAutocomplete(interaction, ctx) {
  // Solo aplica al comando /item y al option "name"
  if (interaction.commandName !== 'item') return false;

  const focused = interaction.options.getFocused(true);
  if (!focused || focused.name !== 'name') return false;

  const choices = searchChoices(ctx.itemsIndex, focused.value);

  await interaction.respond(choices);
  return true;
}

module.exports = { handleItemAutocomplete };
