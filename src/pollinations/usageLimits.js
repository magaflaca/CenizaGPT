// src/pollinations/usageLimits.js
const fs = require('fs');
const path = require('path');

// Archivo estable (NO depende de cwd raro). Puedes fijarlo con env:
// USAGE_LIMITS_PATH=/home/ubuntu/v4/usage-limits.json
const DATA_FILE = process.env.USAGE_LIMITS_PATH
  ? path.resolve(process.env.USAGE_LIMITS_PATH)
  : path.join(process.cwd(), 'usage-limits.json');

// Legacy (por si venías de data/usage-limits.json)
const LEGACY_FILE = path.join(process.cwd(), 'data', 'usage-limits.json');

// Límites diarios
const LIMITS = {
  // Nanobanana global (compartido para todo lo que use nanobanana)
  global_per_day: 15,

  // Por usuario
  edit_per_day: 2, // /editar o editar por chat cuando usa nanobanana
  gen_per_day: 1,  // /dibujar con nanoceniza pro (nanobanana)
};

function todayKeyUTC() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function defaultState() {
  return {
    day: todayKeyUTC(),
    nanobanana: {
      global_used: 0,
      // per_user_used[userId] puede ser:
      // - number (legacy: se interpreta como edit_used)
      // - { edit: number, gen: number }
      per_user_used: {},
    },
  };
}

function safeReadJson(p) {
  try {
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function safeWriteJson(p, obj) {
  try {
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
}

function migrateIfNeeded() {
  try {
    if (!fs.existsSync(DATA_FILE) && fs.existsSync(LEGACY_FILE)) {
      const legacy = safeReadJson(LEGACY_FILE);
      if (legacy) safeWriteJson(DATA_FILE, legacy);
    }
  } catch (_) {}
}

let STATE = (() => {
  migrateIfNeeded();
  const parsed = safeReadJson(DATA_FILE);
  if (!parsed) return defaultState();

  // Normalizar
  if (!parsed.day) parsed.day = todayKeyUTC();
  if (!parsed.nanobanana) parsed.nanobanana = { global_used: 0, per_user_used: {} };
  if (typeof parsed.nanobanana.global_used !== 'number') parsed.nanobanana.global_used = Number(parsed.nanobanana.global_used || 0) || 0;
  if (!parsed.nanobanana.per_user_used || typeof parsed.nanobanana.per_user_used !== 'object') parsed.nanobanana.per_user_used = {};

  return parsed;
})();

function save() {
  safeWriteJson(DATA_FILE, STATE);
}

function resetIfNeeded() {
  const t = todayKeyUTC();
  if (STATE.day !== t) {
    STATE = defaultState();
    save();
  }
}

function normalizeUserEntry(entry) {
  // Legacy: number => edit_used
  if (typeof entry === 'number') {
    return { edit: Math.max(0, entry), gen: 0 };
  }
  if (!entry || typeof entry !== 'object') {
    return { edit: 0, gen: 0 };
  }
  const edit = Number(entry.edit || 0);
  const gen = Number(entry.gen || 0);
  return {
    edit: Number.isFinite(edit) ? Math.max(0, edit) : 0,
    gen: Number.isFinite(gen) ? Math.max(0, gen) : 0,
  };
}

function getUserEntry(userId) {
  resetIfNeeded();
  const id = String(userId || '');
  const raw = STATE.nanobanana.per_user_used[id];
  return normalizeUserEntry(raw);
}

function setUserEntry(userId, entry) {
  resetIfNeeded();
  const id = String(userId || '');
  if (!id) return;
  STATE.nanobanana.per_user_used[id] = normalizeUserEntry(entry);
  save();
}

function getGlobalUsed() {
  resetIfNeeded();
  const n = Number(STATE.nanobanana.global_used || 0);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function setGlobalUsed(n) {
  resetIfNeeded();
  STATE.nanobanana.global_used = Math.max(0, Number(n || 0));
  save();
}

// -----------------------------
// API: Edición nanobanana (2/d)
// Mantengo nombres existentes usados por chatImageActions.js
// -----------------------------
function canUseNanobanana(userId) {
  const u = getUserEntry(userId);
  return u.edit < LIMITS.edit_per_day;
}

function consumeNanobanana(userId, amount = 1) {
  const u = getUserEntry(userId);
  u.edit += Number(amount || 1);
  setUserEntry(userId, u);
}

function remainingNanobanana(userId) {
  const u = getUserEntry(userId);
  return Math.max(0, LIMITS.edit_per_day - u.edit);
}

// -----------------------------
// API: Generación nanobanana (1/d)
// (para /dibujar con nanoceniza pro)
// -----------------------------
function canUseNanobananaGen(userId) {
  const u = getUserEntry(userId);
  return u.gen < LIMITS.gen_per_day;
}

function consumeNanobananaGen(userId, amount = 1) {
  const u = getUserEntry(userId);
  u.gen += Number(amount || 1);
  setUserEntry(userId, u);
}

function remainingNanobananaGen(userId) {
  const u = getUserEntry(userId);
  return Math.max(0, LIMITS.gen_per_day - u.gen);
}

// -----------------------------
// API: Global (15/d) compartido
// -----------------------------
function canUseNanobananaGlobal() {
  return getGlobalUsed() < LIMITS.global_per_day;
}

function consumeNanobananaGlobal(amount = 1) {
  setGlobalUsed(getGlobalUsed() + Number(amount || 1));
}

function remainingNanobananaGlobal() {
  return Math.max(0, LIMITS.global_per_day - getGlobalUsed());
}

module.exports = {
  // edit (compat)
  canUseNanobanana,
  consumeNanobanana,
  remainingNanobanana,

  // gen (nuevo)
  canUseNanobananaGen,
  consumeNanobananaGen,
  remainingNanobananaGen,

  // global
  canUseNanobananaGlobal,
  consumeNanobananaGlobal,
  remainingNanobananaGlobal,

  // debug
  _limitsFile: DATA_FILE,
};
