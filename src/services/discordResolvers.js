const { normalize } = require('../utils/text');

function extractIdFromMention(text) {
  if (!text) return null;
  const m = String(text).match(/<(?:@!|@|@&|#)(\d+)>/);
  return m ? m[1] : null;
}

async function resolveMember(guild, raw) {
  if (!guild || !raw) return null;
  const q = String(raw).trim();
  const id = extractIdFromMention(q) || (q.match(/^\d{16,20}$/) ? q : null);
  if (id) {
    try {
      const member = await guild.members.fetch(id).catch(() => null);
      if (member) return member;
    } catch (_e) {}
  }

  // Si no es id, intentar búsqueda por query si está soportada
  const queryNorm = normalize(q);
  if (!queryNorm) return null;

  try {
    if (typeof guild.members.search === 'function') {
      const res = await guild.members.search({ query: q, limit: 10 }).catch(() => null);
      if (res && res.size) {
        // elegir el más parecido por displayName/username
        let best = null;
        let bestScore = 1;
        for (const m of res.values()) {
          const dn = normalize(m.displayName || '');
          const un = normalize(m.user?.username || '');
          const score = similarityScore(queryNorm, dn, un);
          if (score < bestScore) {
            bestScore = score;
            best = m;
          }
        }
        if (best && bestScore <= 0.35) return best;
      }
    }
  } catch (_e) {}

  // Fallback: cache (puede no contener todos)
  try {
    const members = guild.members.cache;
    let best = null;
    let bestScore = 1;
    for (const m of members.values()) {
      const dn = normalize(m.displayName || '');
      const un = normalize(m.user?.username || '');
      const score = similarityScore(queryNorm, dn, un);
      if (score < bestScore) {
        bestScore = score;
        best = m;
      }
    }
    if (best && bestScore <= 0.28) return best;
  } catch (_e) {}

  return null;
}

async function resolveRole(guild, raw) {
  if (!guild || !raw) return null;
  const q = String(raw).trim();
  const id = extractIdFromMention(q) || (q.match(/^\d{16,20}$/) ? q : null);
  if (id) {
    return guild.roles.fetch(id).catch(() => null);
  }
  const queryNorm = normalize(q);
  if (!queryNorm) return null;

  let best = null;
  let bestScore = 1;
  for (const role of guild.roles.cache.values()) {
    const rn = normalize(role.name || '');
    const score = similarityScore(queryNorm, rn);
    if (score < bestScore) {
      bestScore = score;
      best = role;
    }
  }
  if (best && bestScore <= 0.28) return best;
  return null;
}

function levenshtein(a, b) {
  a = a || '';
  b = b || '';
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(
        dp[j] + 1,
        dp[j - 1] + 1,
        prev + cost
      );
      prev = temp;
    }
  }
  return dp[n];
}

function similarityScore(queryNorm, ...candidatesNorm) {
  const candidates = candidatesNorm.filter(Boolean);
  if (!candidates.length) return 1;
  let best = 1;
  for (const c of candidates) {
    const dist = levenshtein(queryNorm, c);
    const denom = Math.max(queryNorm.length, c.length, 1);
    const score = dist / denom;
    if (score < best) best = score;
  }
  return best;
}

module.exports = {
  resolveMember,
  resolveRole,
  extractIdFromMention,
};
