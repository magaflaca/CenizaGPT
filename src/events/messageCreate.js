const {
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');

const { maybeHandleImageMention } = require('../vision/imageMentionHandler');
const { runChatDraw, runChatEdit, findImageUrlFromMessageOrReply } = require('../pollinations/chatImageActions');
const { handleChatItem } = require('../services/chatItemHandler');
const { handleChatWiki } = require('../services/chatWikiHandler');
const { normalize, chunkString } = require('../utils/text');
const { getSpeakerProfile } = require('../services/speakerProfile');
const { generateChatReply, formatUserMessageForLLM } = require('../services/chatService');
const { looksLikeActionRequest, tryRuleBasedParse, parseActionWithLLM } = require('../services/actionParser');
const { resolveMember, resolveRole } = require('../services/discordResolvers');
const { answerAboutItem, looksLikeTerrariaFollowup } = require('../services/terrariaChat');
const { terrariaSummarize, terrariaAsk } = require('../terraria/terrariaBridge');
const { maybeHandleServerQuery } = require('../services/serverQueryRouter');
const { maybeHandleReplyAssist } = require('../services/replyAssistant');
const { routePrompt } = require('../services/promptRouter');
const { analyzeVideo } = require('../services/videoBridge');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');

function hasExplicitBotMention(message, client) {
  const raw = String(message?.content || '');
  const a = `<@${client.user.id}>`;
  const b = `<@!${client.user.id}>`;
  return raw.includes(a) || raw.includes(b);
}

function hasPrefixInvocation(message) {
  const t = normalize(message?.content || '');
  return t.startsWith('ceniza') || t.startsWith('cenizagpt');
}

function hasTagInvocation(text) {
  const t = normalize(text || '');
  return t.includes('@dibujar') || t.includes('@editar') || t.includes('@video');
}

function shouldRespondToMessage(message, client) {
  if (!message) return false;
  if (message.author?.bot) return false;

  // DMs: responder siempre
  if (!message.guild) return true;

  // Mención explícita en el contenido (evita el ping automático de replies)
  if (hasExplicitBotMention(message, client)) return true;

  // Reply: lo evaluamos más abajo (solo si es reply al bot)
  if (message.reference) return true;

  // Prefijo de texto natural
  if (hasPrefixInvocation(message)) return true;

  // Tags tipo "@editar" / "@dibujar" (permiten usarlo como pseudo-comando)
  if (hasTagInvocation(message.content)) return true;

  return false;
}

async function isReplyToBot(message, client) {
  if (!message.reference) return false;
  try {
    const replied = await message.fetchReference();
    return replied?.author?.id === client.user.id;
  } catch (_e) {
    return false;
  }
}

function stripBotCallPrefix(raw, client) {
  let text = String(raw || '').trim();
  if (!text) return '';

  // Quitar menciones al bot
  const a = `<@${client.user.id}>`;
  const b = `<@!${client.user.id}>`;
  text = text.split(a).join(' ');
  text = text.split(b).join(' ');
  text = text.trim();

  // Quitar "ceniza" al inicio
  const parts = text.split(' ');
  if (parts.length) {
    const first = normalize(parts[0]).replace(/[^a-z0-9]/g, '');
    if (first === 'ceniza' || first === 'cenizagpt') {
      parts.shift();
      text = parts.join(' ').trim();
    }
  }

  // Quitar coma inicial
  while (text.startsWith(',') || text.startsWith(':')) text = text.slice(1).trim();

  return text;
}

function looksLikeReset(text) {
  const t = normalize(text);
  if (!t) return false;
  const signals = [
    'olvida',
    'reset',
    'reinicia conversacion',
    'reinicia la conversacion',
    'nueva conversacion',
    'nuevo chat',
    'borrar historial',
  ];
  return signals.some((s) => t.includes(s));
}

async function handleLegacyConfigCommands(message, ctx) {
  const prefix = '!';
  if (!message.content.startsWith(prefix)) return false;

  if (!message.member?.permissions?.has(PermissionsBitField.Flags.Administrator)) {
    await message.reply('❌ No tienes permisos de Administrador para configurar el bot.');
    return true;
  }

  const args = message.content.slice(prefix.length).trim().split(' ').filter(Boolean);
  const command = (args.shift() || '').toLowerCase();
  const value = args.join(' ');

  const cfg = ctx.configStore.get();

  switch (command) {
    case 'serverip':
      ctx.configStore.setPath(['ip'], value);
      await message.reply(`✅ IP actualizada a: **${value}**`);
      return true;

    case 'serverport':
      ctx.configStore.setPath(['port'], value);
      await message.reply(`✅ Puerto actualizado a: **${value}**`);
      return true;

    case 'context':
      if (args[0] === 'add') {
        const text = args.slice(1).join(' ');
        cfg.context = cfg.context || [];
        cfg.context.push(text);
        ctx.configStore.save();
        await message.reply('🧠 Contexto agregado.');
        return true;
      }
      if (args[0] === 'clear') {
        cfg.context = [];
        ctx.configStore.save();
        await message.reply('🧠 Contexto borrado.');
        return true;
      }
      await message.reply('Uso: !context add <texto> | !context clear');
      return true;

    case 'boss':
      if (args[0] === 'add') {
        const name = args.slice(1).join(' ');
        cfg.bosses = cfg.bosses || [];
        cfg.bosses.push(name);
        ctx.configStore.save();
        await message.reply(`💀 Jefe agregado: **${name}**`);
        return true;
      }
      if (args[0] === 'clear') {
        cfg.bosses = [];
        ctx.configStore.save();
        await message.reply('✨ Lista de jefes borrada.');
        return true;
      }
      await message.reply('Uso: !boss add <nombre> | !boss clear');
      return true;

    case 'evento':
      if (args[0] === 'add') {
        const name = args.slice(1).join(' ');
        cfg.events = cfg.events || [];
        cfg.events.push(name);
        ctx.configStore.save();
        await message.reply(`📅 Evento agregado: **${name}**`);
        return true;
      }
      if (args[0] === 'clear') {
        cfg.events = [];
        ctx.configStore.save();
        await message.reply('🗑️ Eventos borrados.');
        return true;
      }
      await message.reply('Uso: !evento add <nombre> | !evento clear');
      return true;

    case 'reload':
      ctx.configStore.reload();
      await message.reply('🔄 Configuración recargada desde disco.');
      return true;

    case 'config':
      await message.reply(`\`\`\`json\n${JSON.stringify(ctx.configStore.get(), null, 2)}\n\`\`\``);
      return true;

    default:
      // comando legacy desconocido
      return true;
  }
}

async function handleLegacyTerrariaCommands(message, ctx) {
  const raw = String(message.content || '').trim();
  if (!raw) return false;

  const lower = raw.toLowerCase();

  // Prefijos legacy: !item / !wiki (para usuarios que no usan slash)
  if (!(lower.startsWith('!item') || lower.startsWith('!wiki'))) return false;

  // Ignorar mensajes de bots
  if (message.author?.bot) return true;

  const parts = raw.split(/\s+/g);
  const cmd = (parts[0] || '').toLowerCase();

  // Helper para responder en chunks
  const replyChunks = async (text) => {
    const str = String(text || '').trim();
    if (!str) return;
    for (const part of chunkString(str, 1900)) {
      await message.reply(part);
    }
  };

  if (cmd === '!wiki') {
    // Uso:
    //   !wiki <url>
    //   !wiki <url> <pregunta...>
    const url = parts[1];
    if (!url || !/^https?:\/\//i.test(url)) {
      await message.reply('📚 Uso: `!wiki <url>` o `!wiki <url> <pregunta>`');
      return true;
    }
    const q = parts.slice(2).join(' ').trim();

    try {
      await message.channel.sendTyping();
      const out = q ? await terrariaAsk(url, q) : await terrariaSummarize(url);
      await replyChunks(out);
    } catch (e) {
      console.error('[!wiki] Error:', e);
      await message.reply('⚠️ No pude consultar la wiki ahora mismo. Probá de nuevo en unos minutos o revisá el link.');
    }
    return true;
  }

  if (cmd === '!item') {
    if (!message.guild) {
      await message.reply('Este comando solo funciona dentro de un servidor.');
      return true;
    }

    const sub = (parts[1] || '').toLowerCase();

    const guildId = message.guild.id;
    const userId = message.author.id;

    if (sub === 'clear') {
      ctx.memoryStore.setUserState({ guildId, userId, patch: { activeItem: null } });
      await message.reply('✅ Item activo olvidado.');
      return true;
    }

    if (sub === 'info' || sub === 'ask') {
      // !item info <nombre|id>
      // !item ask <nombre|id> <pregunta...>
      // !item ask <pregunta...>   (usa item activo)
      const rest = parts.slice(2).join(' ').trim();
      if (!rest) {
        await message.reply(sub === 'info'
          ? 'Uso: `!item info <nombre o id>`'
          : 'Uso: `!item ask <nombre o id> <pregunta>` (o `!item ask <pregunta>` si ya hay item activo)');
        return true;
      }

      // Resolver item:
      let item = null;
      let question = '';

      if (sub === 'info') {
        // En info, todo el resto es el nombre
        const name = rest;
        if (/^\d{1,5}$/.test(name)) item = ctx.itemsIndex.findById(Number(name));
        if (!item) {
          const hit = ctx.itemsIndex.findBest(name, { strict: false });
          item = hit?.item || null;
        }
      } else {
        // ask
        // intentamos separar: "<nombre> <pregunta>" o solo "<pregunta>" (usa activo)
        const state = ctx.memoryStore.getUserState({ guildId, userId }) || {};
        const active = state.activeItem;

        // Heurística: si empieza con número o si el primer token matchea exacto, lo tomamos como item
        const first = parts[2] || '';
        let usedActive = false;

        if (/^\d{1,5}$/.test(first)) {
          item = ctx.itemsIndex.findById(Number(first));
          question = parts.slice(3).join(' ').trim();
        } else {
          const hit = ctx.itemsIndex.findBest(first, { strict: true });
          if (hit?.item) {
            item = hit.item;
            question = parts.slice(3).join(' ').trim();
          } else if (active?.url && active?.itemRef) {
            // usar activo
            usedActive = true;
            item = active.itemRef;
            question = rest;
          }
        }

        if (!question) {
          await message.reply('Uso: `!item ask <nombre o id> <pregunta>` (o `!item ask <pregunta>` si ya hay item activo)');
          return true;
        }

        if (usedActive && !item?.wiki_link && !item?.wiki_link_es) {
          // Si el item activo era incompleto, pedir que especifiquen
          item = null;
        }
      }

      if (!item) {
        await message.reply('No encontré ese item. Probá con el nombre exacto (o en inglés) o con `!item info <nombre>`.');
        return true;
      }

      try {
        await message.channel.sendTyping();
        const userText = (sub === 'info') ? `resumen de ${rest}` : question;
        const out = await answerAboutItem({
          memoryStore: ctx.memoryStore,
          guildId,
          userId,
          item,
          userText,
          includeTip: false,
        });
        await replyChunks(out);
      } catch (e) {
        console.error('[!item] Error:', e);
        await message.reply('⚠️ No pude consultar ese item ahora mismo. Probá más tarde.');
      }

      return true;
    }

    // Ayuda
    await message.reply(
      '🧩 Comandos:\n' +
      '- `!item info <nombre|id>`\n' +
      '- `!item ask <nombre|id> <pregunta>` (o `!item ask <pregunta>` si ya hay item activo)\n' +
      '- `!item clear`'
    );
    return true;
  }

  return false;
}

function hasAnyModPermission(member) {
  const perms = [
    PermissionsBitField.Flags.Administrator,
    PermissionsBitField.Flags.KickMembers,
    PermissionsBitField.Flags.BanMembers,
    PermissionsBitField.Flags.ManageRoles,
    PermissionsBitField.Flags.ManageNicknames,
  ];
  return perms.some((p) => member?.permissions?.has(p));
}

function formatDurationShort(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return 'remover';
  const sec = Math.round(n / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.round(n / 60000);
  if (min < 60) return `${min}m`;
  const hr = Math.round(n / 3600000);
  if (hr < 24) return `${hr}h`;
  const day = Math.round(n / 86400000);
  return `${day}d`;
}

async function maybeHandleActionRequest(message, ctx, cleanText, speaker, repliedMessage, opts = {}) {
  if (!message.guild) return false;

  const force = Boolean(opts?.force);
  const forcedAction = (opts?.action && typeof opts.action === 'object') ? opts.action : null;

  // En modo normal, usamos heurística rápida para no interrumpir chats.
  // En modo "force" (router), procesamos aunque no haya keywords.
  if (!force && !looksLikeActionRequest(cleanText)) return false;

  if (!hasAnyModPermission(message.member)) {
    await message.reply('❌ Entiendo la intención, pero no tienes permisos de moderación para pedirme eso.');
    return true;
  }

  const defaultTargetUserId = repliedMessage?.author?.id || null;

  // 1) intentar por reglas (o usar acción pre-parsed desde el router)
  let parsed = { ok: false };

  if (forcedAction && forcedAction.type) {
    parsed = {
      ok: true,
      action: {
        type: forcedAction.type,
        targetUser: forcedAction.targetUser || forcedAction.target || defaultTargetUserId || '',
        role: forcedAction.role || '',
        newNickname: forcedAction.newNickname || forcedAction.new_nickname || '',
        durationMs: forcedAction.durationMs ?? forcedAction.duration_ms ?? null,
        reason: forcedAction.reason || '',
      },
    };
  } else {
    parsed = tryRuleBasedParse(cleanText, { defaultTargetUserId });
  }

  // 2) fallback a LLM parser
  if (!parsed.ok) {
    const repliedSummary = repliedMessage
      ? `autor=<@${repliedMessage.author?.id || '??'}> apodo="${repliedMessage.member?.displayName || repliedMessage.author?.username || 'usuario'}" contenido="${String(repliedMessage.content || '').slice(0, 140)}"`
      : null;

    const llm = await parseActionWithLLM({
      groqClient: ctx.groqNormal,
      model: ctx.models.normal,
      text: cleanText,
      speaker,
      guild: message.guild,
      defaultTargetUserId,
      repliedSummary,
    });
    if (!llm || llm.kind !== 'ACTION') {
      await message.reply('No pude entender la acción exacta. Probá mencionar al usuario y (si aplica) el rol.');
      return true;
    }

    const a = llm.action || {};
    parsed = {
      ok: true,
      action: {
        type: a.type,
        targetUser: a.target || a.targetUser || defaultTargetUserId || '',
        role: a.role,
        newNickname: a.new_nickname || a.newNickname,
        durationMs: a.duration_ms ?? a.durationMs,
        reason: a.reason || '',
      },
    };
  }

  const action = parsed.action;
  if (!action?.type) {
    await message.reply('No pude entender la acción exacta.');
    return true;
  }

  // Resolver objetivo
  const targetRaw = action.targetUser || action.target || defaultTargetUserId || '';
  if (!targetRaw) {
    await message.reply('No pude determinar el usuario objetivo. Menciónalo con @ o responde a su mensaje.');
    return true;
  }

  const targetMember = await resolveMember(message.guild, targetRaw);
  if (!targetMember) {
    await message.reply('No pude encontrar al usuario objetivo. Menciónalo con @ o pega su ID.');
    return true;
  }

  let roleObj = null;
  if (action.type === 'role_add' || action.type === 'role_remove') {
    roleObj = await resolveRole(message.guild, action.role || '');
    if (!roleObj) {
      await message.reply('No pude encontrar el rol. Menciónalo como <@&rol> o usa /role.');
      return true;
    }
  }

  if (action.type === 'nickname_set' && !action.newNickname) {
    await message.reply('Para cambiar apodo, ponelo entre comillas. Ej: cámbiale el apodo a @Usuario a "Nuevo"');
    return true;
  }

  // Pre-chequeos de permisos (evita pedir confirmación si inevitablemente va a fallar)
  const requester = message.member;
  const me = message.guild.members.me || (await message.guild.members.fetchMe().catch(() => null));
  const needPermByAction = {
    kick: PermissionsBitField.Flags.KickMembers,
    ban: PermissionsBitField.Flags.BanMembers,
    timeout: PermissionsBitField.Flags.ModerateMembers,
    nickname_set: PermissionsBitField.Flags.ManageNicknames,
    role_add: PermissionsBitField.Flags.ManageRoles,
    role_remove: PermissionsBitField.Flags.ManageRoles,
  };
  const needPerm = needPermByAction[action.type];

  if (needPerm && requester && !requester.permissions?.has(needPerm)) {
    await message.reply('No tienes permisos suficientes para esa acción.');
    return true;
  }
  if (needPerm && me && !me.permissions?.has(needPerm)) {
    await message.reply('Yo no tengo permisos suficientes para esa acción (revisa permisos del bot / rol más alto).');
    return true;
  }
  if (action.type === 'kick' && !targetMember.kickable) {
    await message.reply('No puedo expulsar a ese usuario (jerarquía de roles o permisos).');
    return true;
  }
  if (action.type === 'ban' && !targetMember.bannable) {
    await message.reply('No puedo banear a ese usuario (jerarquía de roles o permisos).');
    return true;
  }
  if (action.type === 'nickname_set' && !targetMember.manageable) {
    await message.reply('No puedo cambiarle el apodo a ese usuario (jerarquía de roles).');
    return true;
  }
  if (action.type === 'timeout' && !(targetMember.moderatable ?? true)) {
    // moderatable no siempre está presente dependiendo de la versión
  }
  if ((action.type === 'role_add' || action.type === 'role_remove') && roleObj && me) {
    const myTop = me.roles?.highest?.position ?? 0;
    if ((roleObj.position ?? 0) >= myTop) {
      await message.reply('No puedo asignar/quitar ese rol porque está por encima o igual a mi rol más alto.');
      return true;
    }
  }

  if (action.type === 'timeout') {
    const ms = Number(action.durationMs);
    if (!Number.isFinite(ms) || ms < 0) {
      await message.reply('Para timeout necesito una duración válida. Ej: "mutea 10m" / "silencia 1h" o "desmutea".');
      return true;
    }
  }

  // Crear confirmación
  const confirmId = ctx.confirmStore.create({
    requesterId: message.author.id,
    action: {
      type: action.type,
      targetUser: targetMember.id,
      role: roleObj?.id,
      newNickname: action.newNickname,
      durationMs: action.durationMs,
      reason: action.reason || '',
    },
    context: {
      guildId: message.guild.id,
      channelId: message.channel.id,
    },
  });

  const embed = new EmbedBuilder()
    .setTitle('Confirmación requerida')
    .setDescription('Detecté una solicitud administrativa. Para evitar cagadas, confirmá antes de ejecutar.')
    .addFields(
      { name: 'Acción', value: String(action.type), inline: true },
      { name: 'Objetivo', value: `<@${targetMember.id}>`, inline: true },
      ...(action.type === 'timeout' ? [{ name: 'Duración', value: formatDurationShort(action.durationMs), inline: true }] : []),
      ...(roleObj ? [{ name: 'Rol', value: `<@&${roleObj.id}>`, inline: true }] : []),
      ...(action.newNickname ? [{ name: 'Nuevo apodo', value: String(action.newNickname).slice(0, 32), inline: true }] : []),
      { name: 'Razón', value: action.reason || '(sin razón)', inline: false }
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`confirm:${confirmId}`).setLabel('Confirmar').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`cancel:${confirmId}`).setLabel('Cancelar').setStyle(ButtonStyle.Secondary)
  );

  await message.reply({ embeds: [embed], components: [row] });
  return true;
}

async function downloadAttachment(url, ext) {
  const tempPath = path.join(os.tmpdir(), `ceniza_vid_${Date.now()}.${ext}`);
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(tempPath);
    https.get(url, (response) => {
      response.pipe(file);
      file.on('finish', () => {
        file.close(() => resolve(tempPath));
      });
    }).on('error', (err) => {
      fs.unlink(tempPath, () => { });
      reject(err);
    });
  });
}

async function maybeHandleVideoRequest(message, ctx, cleanText, repliedMessage) {
  if (!message.guild) return false;

  const norm = normalize(cleanText);
  if (!norm.includes('@video')) return false;

  // Remove @video from prompt
  const prompt = cleanText.replace(/@video/gi, '').trim();
  if (!prompt) {
    await message.reply('¿Qué querés saber del video? Decime algo como "@ceniza @video resumilo"');
    return true;
  }

  // Identificar input (URL o Attachment)
  let targetUrl = null;
  let targetAttachment = null;

  // 1. Current message attachment
  if (message.attachments.size > 0) {
    targetAttachment = message.attachments.first();
  }
  // 2. Replied message attachment
  else if (repliedMessage?.attachments?.size > 0) {
    targetAttachment = repliedMessage.attachments.first();
  }
  // 3. Current message URL
  else {
    const urlMatch = cleanText.match(/https?:\/\/[^\s>]+/i);
    if (urlMatch) targetUrl = urlMatch[0];
    // 4. Replied message URL
    else if (repliedMessage?.content) {
      const replyUrlMatch = repliedMessage?.content.match(/https?:\/\/[^\s>]+/i);
      if (replyUrlMatch) targetUrl = replyUrlMatch[0];
    }
  }

  if (!targetUrl && !targetAttachment) {
    await message.reply('No encuentro ningún video o audio. Adjuntalo, pegá el link, o respondé a un mensaje que lo tenga.');
    return true;
  }

  // Execute
  await message.channel.sendTyping();
  let tempFile = null;

  try {
    let result = '';
    if (targetUrl) {
      result = await analyzeVideo({
        mode: 'url',
        input: targetUrl,
        prompt,
        model: ctx.models.smart
      });
    } else if (targetAttachment) {
      const ext = targetAttachment.name.split('.').pop() || 'tmp';
      tempFile = await downloadAttachment(targetAttachment.url, ext);
      result = await analyzeVideo({
        mode: 'file',
        input: tempFile,
        prompt,
        model: ctx.models.smart
      });
    }

    if (result.length > 1900) result = result.slice(0, 1900) + '...';
    await message.reply(result);

  } catch (e) {
    console.error('[maybeHandleVideoRequest] Error:', e);
    let msg = '⚠️ Error procesando el video/audio.';
    if (e.message) msg += `\nError: ${e.message}`;
    await message.reply(msg);
  } finally {
    if (tempFile && fs.existsSync(tempFile)) {
      try { fs.unlinkSync(tempFile); } catch { }
    }
  }

  return true;
}

async function maybeHandleTerraria(message, ctx, cleanText, repliedMessage) {
  if (!message.guild) return false;

  const guildId = message.guild.id;
  const userId = message.author.id;
  const channelName = message.channel?.name || '';
  const t = normalize(cleanText);

  // Comando rápido para despegarse de un item (solo contexto de /item y !item)
  if (t.includes('olvida') && t.includes('item')) {
    ctx.memoryStore.setUserState({ guildId, userId, patch: { activeItem: null } });
    await message.reply('✅ Listo. Olvidé el item activo.');
    return true;
  }

  // Si pegó un link de la wiki de Terraria, NO lo procesamos automáticamente (evita spam/errores).
  // En su lugar guiamos al usuario a usar /wiki o !wiki.
  const urlMatch = cleanText.match(/https?:\/\/[^\s>]+/i);
  if (urlMatch) {
    const url = urlMatch[0];
    let isTerrariaWiki = false;
    try {
      const u = new URL(url);
      isTerrariaWiki = /terraria\.(fandom\.com|wiki\.gg)$/i.test(u.hostname) && /\/wiki\//i.test(u.pathname);
    } catch (_e) {
      isTerrariaWiki = false;
    }
    if (isTerrariaWiki) {
      await message.reply(
        '📚 Veo un link de la wiki.\n' +
        'Usa **/wiki summarize** para resumirlo, o **/wiki ask** para hacer una pregunta.\n' +
        'También podés usar: `!wiki <url>` o `!wiki <url> <pregunta>`'
      );
      return true;
    }
  }

  // Si el usuario parece estar preguntando por un item/objeto, guiamos a /item (sin autodetectar).
  const looksTerraria = ctx.itemsIndex.looksLikeTerrariaTopic(cleanText, { channelName });
  if (looksTerraria && (t.includes('para que') || t.includes('sirve') || t.includes('crafte') || t.includes('receta') || t.includes('drop') || t.includes('obtien') || t.includes('daño') || t.includes('danio'))) {
    await message.reply(
      '🧩 Para consultar **items de Terraria** usa:\n' +
      '- **/item info <nombre o id>** (resumen)\n' +
      '- **/item ask <nombre o id> <pregunta>** (preguntas)\n' +
      'Si no te funcionan los slash commands:\n' +
      '- `!item info <nombre o id>`\n' +
      '- `!item ask <nombre o id> <pregunta>`'
    );
    return true;
  }

  return false;
}

async function messageCreate(message, ctx) {
  const client = ctx.client;

  // Legacy config commands
  const legacyHandled = await handleLegacyConfigCommands(message, ctx);
  if (legacyHandled) return;

  const legacyTerrariaHandled = await handleLegacyTerrariaCommands(message, ctx);
  if (legacyTerrariaHandled) return;
  if (!shouldRespondToMessage(message, client)) return;

  // Reply al bot realmente? (evita que un reply a otro usuario dispare el bot)
  if (message.reference) {
    const isReply = await isReplyToBot(message, client);
    if (!isReply) {
      const invOk = hasExplicitBotMention(message, client) || hasPrefixInvocation(message) || hasTagInvocation(message.content);
      if (!invOk) return;
    }
  }

  const cleanText = stripBotCallPrefix(message.content, client);
  if (!cleanText) return;

  // Si el usuario respondió a un mensaje, intentamos recuperar ese mensaje una sola vez
  let repliedMessage = null;
  if (message.reference?.messageId) {
    try {
      repliedMessage = await message.fetchReference();
    } catch (_e) {
      repliedMessage = null;
    }
  }


  // Si es reply a un mensaje del bot que contiene una imagen, NO respondemos automáticamente
  // a menos que el usuario nos mencione o use el prefijo "ceniza...".
  if (repliedMessage && repliedMessage.author?.id === client.user.id) {
    const hasBotMention = message.mentions?.users?.has(client.user.id);
    const norm = normalize(message.content || '');
    const hasPrefix = norm.startsWith('ceniza') || norm.startsWith('cenizagpt');
    const repliedHasImage = (repliedMessage.attachments?.size || 0) > 0 && [...repliedMessage.attachments.values()].some(a => (a.contentType || '').startsWith('image/'));
    if (repliedHasImage && !hasBotMention && !hasPrefix) {
      return;
    }
  }

  const speaker = getSpeakerProfile(message.member);

  await message.channel.sendTyping();
  // ---------------------------------------------------------
  // PRE-ANÁLISIS (router LLM): decide qué subsistema debe actuar
  // ---------------------------------------------------------
  const cfg = ctx.configStore.get();
  const channelName = message.channel?.name || '';

  const invokedExplicit = hasExplicitBotMention(message, client) || hasPrefixInvocation(message);
  const invokedByTag = hasTagInvocation(message.content);
  const isReply = Boolean(message.reference);
  const replyToBot = repliedMessage?.author?.id === client.user.id;

  if (invokedByTag && /@video/i.test(message.content)) {
    if (await maybeHandleVideoRequest(message, ctx, cleanText, repliedMessage)) return;
  }

  // Señales útiles para el router (sin ejecutar acciones)
  const firstUrl = (String(cleanText || '').match(/https?:\/\/[^\s>]+/i) || [null])[0];
  const anyImageUrl = findImageUrlFromMessageOrReply({ message, repliedMessage });

  let itemHint = null;
  try {
    if (ctx.itemsIndex && typeof ctx.itemsIndex.detectItemInMessage === 'function') {
      const det = ctx.itemsIndex.detectItemInMessage(cleanText, { channelName });
      if (det?.item) {
        itemHint = {
          id: det.item.id,
          name_es: det.item.name_es || det.item.name,
          name_en: det.item.name,
          score: det.score,
          phrase: det.phrase,
        };
      }
    }
  } catch (_e) {
    itemHint = null;
  }

  // Último contexto de reply (para follow-ups tipo "resume eso")
  let lastReplyHint = null;
  if (message.guild) {
    try {
      const st = ctx.memoryStore.getUserState({ guildId: message.guild.id, userId: message.author.id }) || {};
      const lr = st.lastReplyContext;
      if (lr?.content) {
        lastReplyHint = {
          authorName: lr.authorName,
          hasImage: Boolean(lr.hasImage),
          ts: lr.ts,
          contentSnippet: String(lr.content).slice(0, 220),
        };
      }
    } catch (_e) {
      lastReplyHint = null;
    }
  }

  const decision = await routePrompt({
    groqClient: ctx.groqRouter || ctx.groqNormal,
    model: ctx.models.router || ctx.models.normal,
    config: cfg,
    text: cleanText,
    meta: {
      invoked_explicit: invokedExplicit,
      invoked_by_tag: invokedByTag,
      reply_to_bot: replyToBot,
      is_reply: isReply,
      has_image: Boolean(anyImageUrl),
      url: firstUrl,
      has_tag_draw: /@dibujar/i.test(cleanText),
      has_tag_edit: /@editar/i.test(cleanText),
      item_hint: itemHint,
      last_reply_hint: lastReplyHint,
    },
    maxTokens: 260,
  });

  // Reset (router o heurística fallback)
  if (decision.route === 'RESET' || looksLikeReset(cleanText)) {
    if (message.guild) {
      ctx.memoryStore.resetUser({ guildId: message.guild.id, userId: message.author.id });
      ctx.memoryStore.resetChannel({ guildId: message.guild.id, channelId: message.channel.id });
    }
    await message.reply('✅ ok, reinicié el historial reciente de este chat (la config del server se mantiene).');
    return;
  }

  // ---------------------------------------------------------
  // ROUTES (acciones)
  // ---------------------------------------------------------

  if (decision.route === 'DRAW') {
    // Por chat: nunca permitir nanobanana aquí (solo /dibujar pro o lógica aparte)
    const prompt = String(decision.prompt || cleanText || '').trim();
    if (!prompt) {
      await message.reply('decime qué querés que dibuje. ej: "dibuja un slime con sombrero"');
      return;
    }
    await runChatDraw({
      message,
      promptText: prompt,
      modelLabel: decision.model_label,
      width: decision.width,
      height: decision.height,
      seed: decision.seed,
      ctx,
    });
    return;
  }

  if (decision.route === 'EDIT') {
    const prompt = String(decision.prompt || cleanText || '').trim();
    if (!prompt) {
      await message.reply('decime qué cambio querés hacer. ej: "poné el árbol rosado"');
      return;
    }

    const imageUrl = decision.image_url || anyImageUrl;
    if (!imageUrl) {
      await message.reply('necesito una imagen para editar: respondé a una imagen o pegá el link directo.');
      return;
    }

    await runChatEdit({
      message,
      userId: message.author.id,
      promptText: prompt,
      imageUrl,
      fallbackModelLabel: decision.fallback_model_label,
      repliedMessage,
      width: decision.width,
      height: decision.height,
      seed: decision.seed,
      ctx,
    });
    return;
  }

  if (decision.route === 'ITEM') {
    const handled = await handleChatItem({
      message,
      ctx,
      cleanText,
      itemQuery: decision.item_query,
      question: decision.question,
    });
    if (handled) return;
    // si no se pudo, seguimos a chat normal
  }

  if (decision.route === 'WIKI') {
    const handled = await handleChatWiki({
      message,
      cleanText,
      url: decision.url,
      question: decision.question,
    });
    if (handled) return;
  }

  if (decision.route === 'VISION') {
    // Visión solo cuando el usuario invoca explícitamente (mención escrita o prefijo)
    if (!invokedExplicit) {
      await message.reply('para analizar una imagen, mención a <@' + client.user.id + '> y decime qué querés que haga con la imagen.');
      return;
    }
    const ok = await maybeHandleImageMention({
      message,
      clientUserId: client.user.id,
      force: true,
      promptOverride: decision.prompt || cleanText,
      repliedMessage,
      ctx,
    });
    if (!ok) {
      await message.reply('no veo una imagen. respondé a una imagen o pegá el link directo, y decime qué querés que haga.');
    }
    return;
  }

  if (decision.route === 'REPLY_ASSIST') {
    if (await maybeHandleReplyAssist({ message, ctx, cleanText, speaker, repliedMessage })) return;
  }

  if (decision.route === 'SERVER') {
    const handled = await maybeHandleServerQuery({
      message,
      ctx,
      cleanText,
      repliedMessage,
      forcedIntent: decision.server_intent,
      forcedArgs: decision.args,
    });
    if (handled) return;
  }

  if (decision.route === 'MOD_ACTION') {
    if (await maybeHandleActionRequest(message, ctx, cleanText, speaker, repliedMessage)) return;
  }

  // 3) Chat normal
  const memoryHistory = message.guild
    ? ctx.memoryStore.getChatHistory({ guildId: message.guild.id, channelId: message.channel.id })
    : [];

  const reply = await generateChatReply({
    groqClient: ctx.groqNormal,
    model: ctx.models.normal,
    config: cfg,
    guild: message.guild,
    speaker,
    memoryHistory,
    text: cleanText,
  });

  // Guardar memoria
  if (message.guild) {
    ctx.memoryStore.addChatMessage({
      guildId: message.guild.id,
      channelId: message.channel.id,
      role: 'user',
      content: formatUserMessageForLLM({ speaker, text: cleanText }),
    });
    ctx.memoryStore.addChatMessage({
      guildId: message.guild.id,
      channelId: message.channel.id,
      role: 'assistant',
      content: reply,
    });
  }

  for (const part of chunkString(reply, 1900)) {
    await message.reply(part);
  }
}

module.exports = { messageCreate };
