// src/services/serverQueryRouter.js
const { normalize } = require('../utils/text');
const { resolveMember } = require('./discordResolvers');
const {
  formatPublicChannelList,
  findLikelyRulesChannel,
  findChannelByQuery,
  analyzeTextChannel,
  buildMemberInfo,
  buildAvatarEmbed,
  isPublicChannel,
  listPublicChannels,
} = require('./serverInspector');

function includesAny(t, list) {
  return list.some((w) => t.includes(normalize(w)));
}

function extractQuoted(text) {
  const m = String(text || '').match(/"([^\n\r"]{1,80})"/);
  return m ? m[1] : null;
}

function extractChannelQuery(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  // mention <#id>
  const mention = raw.match(/<#[0-9]{16,20}>/);
  if (mention) return mention[0];

  const quoted = extractQuoted(raw);
  if (quoted) return quoted;

  // después de "canal" o "canal de"
  const t = normalize(raw);
  const m = t.match(/\bcanal(?:\s+de)?\s+([a-z0-9 _-]{2,40})/i);
  if (m && m[1]) return m[1];

  return null;
}

function wantsAvatar(t) {
  return includesAny(t, ['avatar', 'foto de perfil', 'pfp', 'imagen de perfil', 'perfil']);
}

function looksLikeOwnerQuestion(t) {
  return includesAny(t, ['dueño del servidor', 'dueño del server', 'owner del servidor', 'owner del server', 'quien es el dueño', 'quién es el dueño']);
}

function looksLikeRoleStructureQuestion(t) {
  return includesAny(t, ['estructura de roles', 'jerarquia de roles', 'jerarquía de roles', 'orden de roles', 'roles importantes', 'roles del staff']);
}

function looksLikeRulesWhereQuestion(t) {
  return includesAny(t, ['reglas', 'rules', 'normas']) && includesAny(t, ['donde', 'dónde', 'canal', 'ver', 'conocer', 'leer']);
}

function looksLikeChannelsListQuestion(t) {
  return (
    includesAny(t, [
      'lista de canales', 'listado de canales', 'canales del server', 'canales del servidor',
      'que canales hay', 'qué canales hay', 'dame los canales', 'muéstrame los canales', 'muestrame los canales'
    ]) || t === 'canales'
  );
}

function looksLikeServerSummaryQuestion(t) {
  return includesAny(t, ['resumen del server', 'resumen del servidor', 'info del server', 'informacion del server', 'estadisticas del server', 'estadísticas del server', 'stats del server']);
}

function looksLikeChannelPurposeQuestion(t) {
  return includesAny(t, ['para que sirve', 'para qué sirve', 'que se hace en', 'qué se hace en', 'de que va', 'de qué va']) && t.includes('canal');
}

function looksLikeRolesListQuestion(t) {
  return includesAny(t, ['lista de roles', 'roles del server', 'roles del servidor', 'que roles hay', 'qué roles hay']);
}

// --- Target detection para consultas de usuario (CRÍTICO) ---
function extractMentionUserId(text) {
  const m = String(text || '').match(/<@!?([0-9]{16,20})>/);
  return m ? m[1] : null;
}

function extractRawId(text) {
  const m = String(text || '').match(/\b([0-9]{16,20})\b/);
  return m ? m[1] : null;
}

function extractAtName(text) {
  // Detecta "@Pepito" escrito (no mención real)
  const m = String(text || '').match(/@([^\s]{2,32})/);
  return m ? m[1] : null;
}

function hasConcreteUserTarget({ cleanText, repliedMessage }) {
  if (extractMentionUserId(cleanText)) return true;
  if (extractRawId(cleanText)) return true;
  if (extractAtName(cleanText)) return true;
  if (repliedMessage?.author?.id) return true;
  return false;
}

// Si el texto es claramente una pregunta GLOBAL, NO se debe tratar como query de usuario.
function isGlobalServerQuestion(t) {
  return (
    looksLikeOwnerQuestion(t) ||
    looksLikeRoleStructureQuestion(t) ||
    looksLikeRulesWhereQuestion(t) ||
    looksLikeChannelsListQuestion(t) ||
    looksLikeServerSummaryQuestion(t) ||
    looksLikeChannelPurposeQuestion(t) ||
    looksLikeRolesListQuestion(t)
  );
}

// --- Contexto desde serverConfig.json / configStore (PRIMERO) ---
function getCfg(ctx) {
  // compat: a veces ctx.configStore.get() existe, a veces ctx.serverConfig existe
  const a = ctx?.configStore?.get?.();
  const b = ctx?.serverConfig;
  return a || b || {};
}

function findContextLine(cfg, predicateFn) {
  const arr = cfg?.context;
  if (!Array.isArray(arr)) return null;
  return arr.find((x) => predicateFn(String(x || '')));
}

async function replyLongText(message, text, filenameBase) {
  const out = String(text || '');
  if (out.length <= 1800) {
    await message.reply(out);
  } else {
    const buf = Buffer.from(out, 'utf8');
    await message.reply({
      content: `📎 ${filenameBase || 'respuesta'} adjunta.`,
      files: [{ attachment: buf, name: `${filenameBase || 'respuesta'}.txt` }],
    });
  }
}

async function maybeHandleServerQuery({ message, ctx, cleanText, repliedMessage, forcedIntent = null, forcedArgs = null }) {
  if (!message.guild) return false;

  const t = normalize(cleanText);
  if (!t) return false;

  const cfg = getCfg(ctx);

  // =========================================================
  // (FORCED) MODO DIRIGIDO POR ROUTER (sin heurísticas)
  // =========================================================
  // Cuando el prompt router decidió explícitamente que esto es una consulta del servidor,
  // podemos ejecutar una rama concreta aunque el texto no contenga las keywords exactas.
  // Si algo falla, devolvemos false para que el LLM principal responda.
  const fin = forcedIntent ? String(forcedIntent).toUpperCase().trim() : null;
  const fargs = (forcedArgs && typeof forcedArgs === 'object') ? forcedArgs : {};

  if (fin) {
    try {
      if (fin === 'CHANNELS_LIST') {
        const list = formatPublicChannelList(message.guild);
        await replyLongText(message, list, 'canales_publicos');
        return true;
      }

      if (fin === 'RULES_WHERE') {
        const ch = findLikelyRulesChannel(message.guild);
        if (ch) {
          let out = `📌 Las reglas suelen estar en: ${ch.toString()}`;
          if (cfg?.rules) out += `\n\nTexto de reglas configurado:\n${String(cfg.rules).slice(0, 900)}`;
          await message.reply(out);
          return true;
        }
        if (cfg?.rules) {
          await message.reply(`No encontré un canal obvio de reglas, pero en la configuración figura:\n${String(cfg.rules).slice(0, 1500)}`);
          return true;
        }
        await message.reply('No encontré un canal obvio de reglas y no hay reglas configuradas.');
        return true;
      }

      if (fin === 'SERVER_SUMMARY') {
        const guild = message.guild;
        const publicChannels = listPublicChannels(guild, { includeCategories: false });
        const textCount = publicChannels.filter((c) => c.isTextBased?.()).length;
        const voiceCount = publicChannels.filter((c) => c.type === 2).length; // GuildVoice
        const catCount = listPublicChannels(guild, { includeCategories: true }).filter((c) => c.type === 4).length; // GuildCategory
        const out = [
          `**Servidor:** ${guild.name}`,
          `- Miembros (aprox): ${guild.memberCount ?? '??'}`,
          `- Canales públicos: ${publicChannels.length} (texto: ${textCount}, voz: ${voiceCount}, categorías: ${catCount})`,
        ].join('\n');
        await message.reply(out.slice(0, 1900));
        return true;
      }

      if (fin === 'CHANNEL_PURPOSE') {
        const q = String(fargs.query || fargs.channel || '').trim() || extractChannelQuery(cleanText);
        if (!q) {
          await message.reply('decime el canal (mención #canal o nombre entre comillas). ej: `para qué sirve el canal "conteo"`');
          return true;
        }
        const ch = findChannelByQuery(message.guild, q, { publicOnly: true });
        if (!ch) {
          await message.reply('No encontré ese canal entre los canales públicos (@everyone).');
          return true;
        }
        if (!isPublicChannel(ch, message.guild)) {
          await message.reply('Ese canal no parece ser público para @everyone, así que no lo describo en este chat.');
          return true;
        }
        const analysis = await analyzeTextChannel(ch, { limit: 50 });
        if (!analysis.ok) {
          await message.reply(`Puedo ver el canal ${ch.toString()}, pero no puedo analizar su historial (permisos o límites).`);
          return true;
        }
        const lines = [];
        lines.push(`📌 **${ch.toString()}**`);
        if (analysis.topic) lines.push(`- Tema/Descripción: ${analysis.topic.slice(0, 300)}`);
        if (analysis.purposeSummary) {
          lines.push(`🧭 ${analysis.purposeSummary}`.slice(0, 1800));
        } else if (analysis.looksLikeCounting) {
          lines.push('- Parece un canal de **conteo** (mucha gente envía números consecutivos).');
        } else {
          lines.push(`- Muestras analizadas: ${analysis.totalSamples}`);
          lines.push(`- Mensajes con links (aprox): ${analysis.linkCount}`);
        }
        await message.reply(lines.join('\n').slice(0, 1900));
        return true;
      }

      if (fin === 'ROLES_LIST') {
        const guild = message.guild;
        const roles = [...guild.roles.cache.values()]
          .filter((r) => r.id !== guild.id)
          .sort((a, b) => (b.position ?? 0) - (a.position ?? 0));

        const lines = roles.slice(0, 60).map((r) => `- <@&${r.id}> (${r.name})`);
        const out = `**Roles (top ${Math.min(60, roles.length)}):**\n${lines.join('\n')}`;
        await replyLongText(message, out, 'roles');
        return true;
      }

      if (fin === 'OWNER') {
        const line =
          findContextLine(cfg, (s) => normalize(s).includes('owner del servidor')) ||
          findContextLine(cfg, (s) => normalize(s).includes('dueño del servidor')) ||
          null;

        if (line) {
          await message.reply(String(line).slice(0, 1800));
          return true;
        }

        try {
          const owner = await message.guild.fetchOwner().catch(() => null);
          if (owner?.user) {
            await message.reply(`El dueño del servidor es ${owner.user}.`);
            return true;
          }
        } catch (_) {}

        await message.reply('No pude determinar el dueño automáticamente.');
        return true;
      }

      if (fin === 'ROLE_STRUCTURE') {
        const line =
          findContextLine(cfg, (s) => normalize(s).includes('estructura de roles')) ||
          findContextLine(cfg, (s) => normalize(s).includes('jerarqu') && normalize(s).includes('roles')) ||
          null;

        if (line) {
          await message.reply(String(line).slice(0, 1800));
          return true;
        }

        const guild = message.guild;
        const roles = [...guild.roles.cache.values()]
          .filter((r) => r.id !== guild.id)
          .sort((a, b) => (b.position ?? 0) - (a.position ?? 0))
          .slice(0, 20)
          .map((r) => `- <@&${r.id}> (${r.name})`);

        const out = `**Jerarquía de roles (top 20 por posición):**\n${roles.join('\n')}`;
        await replyLongText(message, out, 'jerarquia_roles');
        return true;
      }

      if (fin === 'USER_INFO') {
        const guild = message.guild;
        const defaultTargetId = repliedMessage?.author?.id || null;

        const targetHint = String(fargs.target || fargs.user || '').trim();

        let target = null;

        // 1) menciones en targetHint o en el texto
        const mentionId = extractMentionUserId(targetHint) || extractMentionUserId(cleanText);
        if (mentionId) target = await guild.members.fetch(mentionId).catch(() => null);

        // 2) reply
        if (!target && defaultTargetId) {
          target = await guild.members.fetch(defaultTargetId).catch(() => null);
        }

        // 3) id raw en hint o texto
        if (!target) {
          const rawId = extractRawId(targetHint) || extractRawId(cleanText);
          if (rawId) target = await guild.members.fetch(rawId).catch(() => null);
        }

        // 4) @Nombre escrito
        if (!target) {
          const atName = extractAtName(targetHint) || extractAtName(cleanText);
          if (atName) target = await resolveMember(guild, atName);
        }

        // 5) nombre/apodo libre
        if (!target && targetHint && targetHint.length >= 2 && targetHint.length <= 48) {
          target = await resolveMember(guild, targetHint);
        }

        if (!target) {
          // Si el router falló/era ambiguo, dejamos el mensaje para el LLM principal.
          // (Esto evita que el bot "interrumpa" chats normales con un error de usuario.)
          return false;
        }

        const info = buildMemberInfo(target, message.channel);
        if (!info) {
          await message.reply('No pude leer info de ese miembro.');
          return true;
        }

        const lines = [];
        lines.push(`👤 **Usuario:** ${info.mention}`);
        lines.push(`- Apodo (server): **${info.displayName}**`);
        lines.push(`- Usuario: **${info.username}**`);
        lines.push(`- Rol más alto: **${info.topRole}**`);
        lines.push(`- Roles (${info.roleCount}): ${info.roleMentions.length ? info.roleMentions.join(' ') : '(solo @everyone)'}`);

        if (info.joinedAt) lines.push(`- Entró al server: <t:${Math.floor(info.joinedAt.getTime() / 1000)}:R>`);
        if (info.createdAt) lines.push(`- Cuenta creada: <t:${Math.floor(info.createdAt.getTime() / 1000)}:R>`);

        // Nota: Discord no expone bio a bots de forma estándar.
        if (includesAny(t, ['bio', 'biografia', 'biografía', 'about me'])) {
          lines.push('- Bio: Discord no expone la biografía (About Me) a los bots con la API estándar.');
        }

        if (wantsAvatar(t) || fargs.avatar === true) {
          const embed = buildAvatarEmbed(target, { title: `Avatar de ${info.displayName}` });
          if (embed) {
            await message.reply({ content: lines.join('\n').slice(0, 1900), embeds: [embed] });
            return true;
          }
        }

        await message.reply(lines.join('\n').slice(0, 1900));
        return true;
      }
    } catch (_e) {
      // Si algo falló en modo forced, dejamos que el LLM principal conteste.
      return false;
    }
  }

  // =========================================================
  // (0) RESPUESTAS DIRECTAS DESDE CONTEXTO JSON (PRIORIDAD MÁXIMA)
  // =========================================================

  // Dueño del server
  if (looksLikeOwnerQuestion(t)) {
    // intenta encontrar una línea que contenga owner
    const line =
      findContextLine(cfg, (s) => normalize(s).includes('owner del servidor')) ||
      findContextLine(cfg, (s) => normalize(s).includes('dueño del servidor')) ||
      null;

    if (line) {
      await message.reply(String(line).slice(0, 1800));
      return true;
    }

    // fallback: intentar fetchOwner si es posible
    try {
      const owner = await message.guild.fetchOwner().catch(() => null);
      if (owner?.user) {
        await message.reply(`El dueño del servidor es ${owner.user}.`);
        return true;
      }
    } catch (_) {}

    await message.reply('No pude determinar el dueño automáticamente.');
    return true;
  }

  // Estructura / jerarquía de roles (contexto primero; si no, inferencia por posición)
  if (looksLikeRoleStructureQuestion(t)) {
    const line =
      findContextLine(cfg, (s) => normalize(s).includes('estructura de roles')) ||
      findContextLine(cfg, (s) => normalize(s).includes('jerarqu') && normalize(s).includes('roles')) ||
      null;

    if (line) {
      await message.reply(String(line).slice(0, 1800));
      return true;
    }

    // fallback: inferir por posición (top roles)
    const guild = message.guild;
    const roles = [...guild.roles.cache.values()]
      .filter((r) => r.id !== guild.id)
      .sort((a, b) => (b.position ?? 0) - (a.position ?? 0))
      .slice(0, 20)
      .map((r) => `- <@&${r.id}> (${r.name})`);

    const out = `**Jerarquía de roles (top 20 por posición):**\n${roles.join('\n')}`;
    await replyLongText(message, out, 'jerarquia_roles');
    return true;
  }

  // =========================================================
  // (1) CONSULTAS GLOBALES DEL SERVER (antes que "usuario")
  // =========================================================

  // 1) Lista de canales públicos
  if (looksLikeChannelsListQuestion(t)) {
    const list = formatPublicChannelList(message.guild);
    await replyLongText(message, list, 'canales_publicos');
    return true;
  }

  // 2) ¿Dónde están las reglas?
  if (looksLikeRulesWhereQuestion(t)) {
    const ch = findLikelyRulesChannel(message.guild);

    if (ch) {
      let out = `📌 Las reglas suelen estar en: ${ch.toString()}`;
      if (cfg?.rules) out += `\n\nTexto de reglas configurado:\n${String(cfg.rules).slice(0, 900)}`;
      await message.reply(out);
      return true;
    }

    if (cfg?.rules) {
      await message.reply(`No encontré un canal obvio de reglas, pero en la configuración figura:\n${String(cfg.rules).slice(0, 1500)}`);
      return true;
    }

    await message.reply('No encontré un canal obvio de reglas y no hay reglas configuradas.');
    return true;
  }

  // 3) Resumen / stats del servidor
  if (looksLikeServerSummaryQuestion(t)) {
    const guild = message.guild;
    const publicChannels = listPublicChannels(guild, { includeCategories: false });
    const textCount = publicChannels.filter((c) => c.isTextBased?.()).length;
    const voiceCount = publicChannels.filter((c) => c.type === 2).length; // GuildVoice
    const catCount = listPublicChannels(guild, { includeCategories: true }).filter((c) => c.type === 4).length; // GuildCategory

    const out = [
      `**Servidor:** ${guild.name}`,
      `- Miembros (aprox): ${guild.memberCount ?? '??'}`,
      `- Canales públicos: ${publicChannels.length} (texto: ${textCount}, voz: ${voiceCount}, categorías: ${catCount})`,
      '',
      'Tip: puedes pedirme **"lista de canales"**, o **"para qué sirve el canal \"conteo\"\"**.',
    ].join('\n');

    await message.reply(out);
    return true;
  }

  // 4) ¿Para qué sirve el canal X?
  if (looksLikeChannelPurposeQuestion(t)) {
    const q = extractChannelQuery(cleanText);
    if (!q) {
      await message.reply('Decime el canal (mención #canal o pon el nombre entre comillas). Ej: `para qué sirve el canal "conteo"`');
      return true;
    }

    const ch = findChannelByQuery(message.guild, q, { publicOnly: true });
    if (!ch) {
      await message.reply('No encontré ese canal entre los canales públicos (@everyone).');
      return true;
    }

    if (!isPublicChannel(ch, message.guild)) {
      await message.reply('Ese canal no parece ser público para @everyone, así que no lo describo en este chat.');
      return true;
    }

    const analysis = await analyzeTextChannel(ch, { limit: 50 });
    if (!analysis.ok) {
      // No mostrar detalles internos largos; dar mensaje útil
      await message.reply(`Puedo ver el canal ${ch.toString()}, pero no puedo analizar su historial (permisos o límites).`);
      return true;
    }

    const lines = [];
    lines.push(`📌 **${ch.toString()}**`);
    if (analysis.topic) lines.push(`- Tema/Descripción: ${analysis.topic.slice(0, 300)}`);

    if (analysis.purposeSummary) {
      lines.push(`🧭 ${analysis.purposeSummary}`.slice(0, 1800));
    } else if (analysis.looksLikeCounting) {
      lines.push('- Parece un canal de **conteo** (mucha gente envía números consecutivos).');
    } else {
      lines.push(`- Muestras analizadas: ${analysis.totalSamples}`);
      lines.push(`- Mensajes con links (aprox): ${analysis.linkCount}`);
    }

    await message.reply(lines.join('\n'));
    return true;
  }

  // 6) Lista de roles (público)
  if (looksLikeRolesListQuestion(t)) {
    const guild = message.guild;
    const roles = [...guild.roles.cache.values()]
      .filter((r) => r.id !== guild.id)
      .sort((a, b) => (b.position ?? 0) - (a.position ?? 0));

    const lines = roles.slice(0, 60).map((r) => `- <@&${r.id}> (${r.name})`);
    const out = `**Roles (top ${Math.min(60, roles.length)}):**\n${lines.join('\n')}`;
    await replyLongText(message, out, 'roles');
    return true;
  }

  // =========================================================
  // (2) INFO DE USUARIO (SOLO SI HAY TARGET REAL)
  // =========================================================

  // OJO: si es pregunta global (dueño/roles/etc), jamás entramos aquí.
  if (
    includesAny(t, [
      'quien es', 'quién es',
      'info del usuario', 'info de usuario',
      'roles de', 'qué roles tiene', 'que roles tiene',
      'rango de', 'rango del usuario',
      'perfil de', 'perfil del usuario',
      'avatar de', 'foto de perfil de',
      'bio', 'biografia', 'biografía', 'about me'
    ])
  ) {
    // si NO hay target concreto, NO devolvemos el error de usuario: dejamos que el LLM conteste
    if (!hasConcreteUserTarget({ cleanText, repliedMessage }) || isGlobalServerQuestion(t)) {
      return false;
    }

    const guild = message.guild;
    const defaultTargetId = repliedMessage?.author?.id || null;

    let target = null;

    const mentionId = extractMentionUserId(cleanText);
    if (mentionId) target = await guild.members.fetch(mentionId).catch(() => null);

    if (!target && defaultTargetId) {
      target = await guild.members.fetch(defaultTargetId).catch(() => null);
    }

    if (!target) {
      const rawId = extractRawId(cleanText);
      if (rawId) target = await guild.members.fetch(rawId).catch(() => null);
    }

    if (!target) {
      // fallback: intenta resolver por nombre SOLO si hay algo razonable
      const tail = cleanText.replace(/<@!?[0-9]{16,20}>/g, '').trim();
      if (tail && tail.length >= 2 && tail.length <= 48) {
        target = await resolveMember(guild, tail);
      }
    }

    if (!target) {
      // Esta respuesta solo se usa cuando el usuario claramente pidió info de una persona
      await message.reply('No pude encontrar al usuario. Menciónalo con @ o responde a uno de sus mensajes.');
      return true;
    }

    const info = buildMemberInfo(target, message.channel);
    if (!info) {
      await message.reply('No pude leer info de ese miembro.');
      return true;
    }

    const lines = [];
    lines.push(`👤 **Usuario:** ${info.mention}`);
    lines.push(`- Apodo (server): **${info.displayName}**`);
    lines.push(`- Usuario: **${info.username}**`);
    lines.push(`- Rol más alto: **${info.topRole}**`);
    lines.push(`- Roles (${info.roleCount}): ${info.roleMentions.length ? info.roleMentions.join(' ') : '(solo @everyone)'}`);

    if (info.joinedAt) lines.push(`- Entró al server: <t:${Math.floor(info.joinedAt.getTime() / 1000)}:R>`);
    if (info.createdAt) lines.push(`- Cuenta creada: <t:${Math.floor(info.createdAt.getTime() / 1000)}:R>`);

    if (includesAny(t, ['bio', 'biografia', 'biografía', 'about me'])) {
      lines.push('- Bio: Discord no expone la biografía (About Me) a los bots con la API estándar.');
    }

    if (wantsAvatar(t)) {
      const embed = buildAvatarEmbed(target, { title: `Avatar de ${info.displayName}` });
      if (embed) {
        await message.reply({ content: lines.join('\n').slice(0, 1900), embeds: [embed] });
        return true;
      }
    }

    await message.reply(lines.join('\n').slice(0, 1900));
    return true;
  }

  return false;
}

module.exports = {
  maybeHandleServerQuery,
};
