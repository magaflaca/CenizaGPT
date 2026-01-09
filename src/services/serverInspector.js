const {
  PermissionsBitField,
  ChannelType,
  EmbedBuilder,
} = require('discord.js');

const { normalize } = require('../utils/text');

function hasEveryoneView(channel, guild) {
  try {
    const everyone = guild.roles.everyone;
    return channel.permissionsFor(everyone)?.has(PermissionsBitField.Flags.ViewChannel);
  } catch (_e) {
    return false;
  }
}

function isPublicChannel(channel, guild) {
  if (!channel || !guild) return false;
  if (!hasEveryoneView(channel, guild)) return false;
  // Evitar canales de sistema o threads efímeros no listables
  if (channel.type === ChannelType.DM) return false;
  return true;
}

function channelSortKey(ch) {
  const parentPos = ch.parent?.position ?? 0;
  const pos = ch.position ?? 0;
  return parentPos * 10_000 + pos;
}

function listPublicChannels(guild, { includeCategories = true } = {}) {
  const channels = [...guild.channels.cache.values()]
    .filter((c) => isPublicChannel(c, guild));

  // Orden por categoría/posición
  channels.sort((a, b) => channelSortKey(a) - channelSortKey(b));

  if (!includeCategories) {
    return channels.filter((c) => c.type !== ChannelType.GuildCategory);
  }

  return channels;
}

function formatPublicChannelList(guild, { maxLines = 180 } = {}) {
  const channels = listPublicChannels(guild, { includeCategories: true });

  // Agrupar por categoría
  const byCat = new Map(); // catId -> { cat, children[] }
  for (const ch of channels) {
    if (ch.type === ChannelType.GuildCategory) {
      byCat.set(ch.id, { cat: ch, children: [] });
    }
  }

  for (const ch of channels) {
    if (ch.type === ChannelType.GuildCategory) continue;
    const catId = ch.parentId || 'no_category';
    if (!byCat.has(catId)) byCat.set(catId, { cat: null, children: [] });
    byCat.get(catId).children.push(ch);
  }

  // Orden de categorías: por posición (cat) y luego no_category al final
  const cats = [...byCat.values()];
  cats.sort((a, b) => {
    if (!a.cat && b.cat) return 1;
    if (a.cat && !b.cat) return -1;
    const pa = a.cat?.position ?? 9999;
    const pb = b.cat?.position ?? 9999;
    return pa - pb;
  });

  const lines = [];
  for (const g of cats) {
    if (lines.length >= maxLines) break;
    const title = g.cat ? `**${g.cat.name}**` : '**(Sin categoría)**';
    lines.push(title);

    const children = g.children.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    for (const ch of children) {
      if (lines.length >= maxLines) break;
      // Mostrar con # mention
      lines.push(`- ${ch.toString()}`);
    }

    lines.push('');
  }

  if (!lines.length) return 'No encuentro canales públicos (VIEW_CHANNEL para @everyone).';
  return lines.join('\n').trim();
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
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      prev = temp;
    }
  }
  return dp[n];
}

function similarityScore(queryNorm, candidateNorm) {
  if (!queryNorm || !candidateNorm) return 1;
  const dist = levenshtein(queryNorm, candidateNorm);
  const denom = Math.max(queryNorm.length, candidateNorm.length, 1);
  return dist / denom;
}

function findChannelByQuery(guild, query, { publicOnly = true } = {}) {
  if (!guild || !query) return null;
  const q = String(query).trim();

  // mention <#id>
  const mention = q.match(/<#[0-9]{16,20}>/);
  if (mention) {
    const id = mention[0].replace(/\D/g, '');
    return guild.channels.cache.get(id) || null;
  }

  const id = q.match(/^\d{16,20}$/) ? q : null;
  if (id) return guild.channels.cache.get(id) || null;

  const qNorm = normalize(q);
  if (!qNorm) return null;

  const channels = [...guild.channels.cache.values()].filter((c) => (publicOnly ? isPublicChannel(c, guild) : true));

  let best = null;
  let bestScore = 1;
  for (const ch of channels) {
    const nameNorm = normalize(ch.name || '');
    const score = similarityScore(qNorm, nameNorm);
    if (score < bestScore) {
      bestScore = score;
      best = ch;
    }
  }

  if (best && bestScore <= 0.35) return best;
  return null;
}

function findLikelyRulesChannel(guild) {
  if (!guild) return null;
  const names = ['reglas', 'rules', 'normas', 'bienvenido', 'welcome', 'info'];

  const channels = listPublicChannels(guild, { includeCategories: false })
    .filter((c) => c.isTextBased?.() && c.type !== ChannelType.GuildForum);

  // 1) match por nombre
  for (const key of names) {
    const hit = channels.find((c) => normalize(c.name).includes(normalize(key)));
    if (hit) return hit;
  }

  // 2) match por topic/description
  for (const ch of channels) {
    const topic = normalize(ch.topic || '');
    if (!topic) continue;
    if (topic.includes('regla') || topic.includes('rules') || topic.includes('norma')) return ch;
  }

  return null;
}

async function analyzeTextChannel(channel, { limit = 40 } = {}) {
  if (!channel || !channel.isTextBased?.()) {
    return { ok: false, error: 'Canal no es de texto.' };
  }

  let messages = [];
  try {
    const fetched = await channel.messages.fetch({ limit: Math.min(100, Math.max(5, limit)) });
    messages = [...fetched.values()].sort((a, b) => (a.createdTimestamp ?? 0) - (b.createdTimestamp ?? 0));
  } catch (_e) {
    return { ok: false, error: 'No pude leer el historial del canal (permiso Read Message History?).' };
  }

  const human = messages.filter((m) => !m.author?.bot);
  const texts = human.map((m) => String(m.content || '').trim()).filter(Boolean);

  const total = texts.length;

  // Conteo (canal de números consecutivos)
  const numeric = texts.filter((c) => /^\d+$/.test(c)).map((c) => Number(c));
  const ratioNumeric = total ? (numeric.length / total) : 0;

  let looksLikeCounting = false;
  if (numeric.length >= Math.min(8, total) && ratioNumeric >= 0.65) {
    let consecutive = 0;
    for (let i = 1; i < numeric.length; i++) {
      if (numeric[i] === numeric[i - 1] + 1) consecutive += 1;
    }
    const ratioConsec = numeric.length > 1 ? (consecutive / (numeric.length - 1)) : 0;
    if (ratioConsec >= 0.55) looksLikeCounting = true;
  }

  const linkCount = texts.filter((c) => /https?:\/\//i.test(c)).length;
  const commandCount = texts.filter((c) => /^[!/]/.test(c)).length;
  const questionCount = texts.filter((c) =>
    /\?/.test(c) || /\b(que|qué|como|cómo|donde|dónde|cuando|cuándo|por que|por qué|para que|para qué)\b/i.test(c)
  ).length;
  const attachmentCount = human.filter((m) => (m.attachments?.size || 0) > 0).length;

  // Palabras frecuentes (heurística simple, sin LLM)
  const stop = new Set([
    'hola','buenas','que','qué','como','cómo','donde','dónde','cuando','cuándo','por','para','porque','porqué',
    'de','del','la','el','los','las','un','una','unos','unas','y','o','a','en','con','sin','al',
    'me','te','se','mi','tu','su','sus','yo','vos','usted','ustedes','ellos','ellas','esto','esta','ese','esa',
    'hay','si','sí','no','ok','xd','jaja','jajaja','lol','gg'
  ]);

  const freq = new Map();
  for (const raw of texts) {
    const t = normalize(raw);
    if (!t) continue;
    for (const w of t.split(/\s+/g)) {
      if (!w || w.length < 3) continue;
      if (stop.has(w)) continue;
      // evitar basura tipo "http"
      if (w.startsWith('http')) continue;
      freq.set(w, (freq.get(w) || 0) + 1);
    }
  }

  const topWords = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([w]) => w);

  // "Para qué sirve" (inferido)
  const topic = channel.topic || '';
  const topicNorm = normalize(topic);
  let purpose = '';

  if (looksLikeCounting) {
    purpose = 'Juego de conteo (los usuarios envían números consecutivos).';
  } else if (topicNorm.includes('regla') || topicNorm.includes('rules') || normalize(channel.name).includes('regla')) {
    purpose = 'Canal de reglas / información importante.';
  } else if (topicNorm.includes('general') || topicNorm.includes('chat')) {
    purpose = 'Chat general del servidor.';
  } else {
    const ratioCommands = total ? (commandCount / total) : 0;
    const ratioQuestions = total ? (questionCount / total) : 0;
    const ratioLinks = total ? (linkCount / total) : 0;

    if (ratioCommands >= 0.35) purpose = 'Canal orientado a comandos de bots / utilidades.';
    else if (ratioQuestions >= 0.35) purpose = 'Canal de preguntas / ayuda (mucha gente pregunta cosas).';
    else if (ratioLinks >= 0.35) purpose = 'Canal de links/recursos (se comparten enlaces con frecuencia).';
    else if (topWords.length) purpose = `Conversación principalmente alrededor de: **${topWords.slice(0, 3).join(', ')}**.`;
    else purpose = 'Canal de conversación general (sin señales fuertes en las muestras recientes).';
  }

  const summaryLines = [];
  summaryLines.push(purpose);
  if (topWords.length) summaryLines.push(`Palabras frecuentes (muestras): ${topWords.join(', ')}`);
  summaryLines.push(`Actividad analizada: ${total} mensajes (humanos), links: ${linkCount}, adjuntos: ${attachmentCount}, comandos: ${commandCount}.`);

  return {
    ok: true,
    topic,
    lastMessageAt: messages.length ? messages[messages.length - 1].createdAt : null,
    totalSamples: total,
    looksLikeCounting,
    ratioNumeric,
    linkCount,
    commandCount,
    questionCount,
    attachmentCount,
    topWords,
    purposeSummary: summaryLines.join(' '),
  };
}

function buildMemberInfo(member, channel = null) {
  if (!member) return null;

  const roles = member.roles.cache
    .filter((r) => r.id !== member.guild.id)
    .sort((a, b) => (b.position ?? 0) - (a.position ?? 0))
    .map((r) => r);
const info = {
    id: member.id,
    mention: `<@${member.id}>`,
    username: member.user?.username || '(desconocido)',
    displayName: member.displayName || member.user?.username || '(desconocido)',
    joinedAt: member.joinedAt,
    createdAt: member.user?.createdAt,
    topRole: roles[0]?.name || '@everyone',
    roleMentions: roles.slice(0, 12).map((r) => `<@&${r.id}>`),
    roleCount: roles.length,
  };

  if (channel && typeof member.permissionsIn === 'function') {
    try {
      const perms = member.permissionsIn(channel);
      const keys = [];
      const add = (flag, label) => {
        if (perms.has(flag)) keys.push(label);
      };
      add(PermissionsBitField.Flags.Administrator, 'Administrator');
      add(PermissionsBitField.Flags.ManageGuild, 'ManageGuild');
      add(PermissionsBitField.Flags.ManageChannels, 'ManageChannels');
      add(PermissionsBitField.Flags.ManageMessages, 'ManageMessages');
      add(PermissionsBitField.Flags.KickMembers, 'KickMembers');
      add(PermissionsBitField.Flags.BanMembers, 'BanMembers');
      add(PermissionsBitField.Flags.ModerateMembers, 'ModerateMembers');
      add(PermissionsBitField.Flags.ManageRoles, 'ManageRoles');
      info.channelPerms = keys;
    } catch (_e) {
      // ignore
    }
  }

  return info;
}

function buildAvatarEmbed(userOrMember, { title = 'Avatar' } = {}) {
  const user = userOrMember?.user || userOrMember;
  if (!user) return null;
  const url = user.displayAvatarURL?.({ extension: 'png', size: 512 }) || null;
  if (!url) return null;

  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(`${user.toString?.() || ''}`)
    .setImage(url);
}

module.exports = {
  listPublicChannels,
  formatPublicChannelList,
  findChannelByQuery,
  findLikelyRulesChannel,
  analyzeTextChannel,
  buildMemberInfo,
  buildAvatarEmbed,
  isPublicChannel,
};
