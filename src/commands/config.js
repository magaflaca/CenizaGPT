const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');

function ensureAdmin(interaction) {
  if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
    throw new Error('❌ Necesitas permiso de Administrador.');
  }
}

function prettyConfig(cfg) {
  return {
    ip: cfg.ip,
    port: cfg.port,
    bosses: cfg.bosses,
    events: cfg.events,
    rules: cfg.rules,
    contextCount: (cfg.context || []).length,
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Configura datos del servidor y preloads/contexto')
    .addSubcommand((s) =>
      s.setName('show').setDescription('Muestra la configuración actual')
    )
    .addSubcommand((s) =>
      s
        .setName('setip')
        .setDescription('Define la IP del servidor')
        .addStringOption((o) => o.setName('ip').setDescription('IP o dominio').setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName('setport')
        .setDescription('Define el puerto del servidor')
        .addStringOption((o) => o.setName('port').setDescription('Puerto').setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName('rules')
        .setDescription('Define reglas del servidor (texto)')
        .addStringOption((o) => o.setName('text').setDescription('Reglas').setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName('context_add')
        .setDescription('Agrega una línea al contexto/preload')
        .addStringOption((o) => o.setName('text').setDescription('Texto').setRequired(true))
    )
    .addSubcommand((s) => s.setName('context_clear').setDescription('Borra todo el contexto/preload'))
    .addSubcommand((s) => s.setName('context_list').setDescription('Lista el contexto/preload'))
    .addSubcommand((s) =>
      s
        .setName('boss_add')
        .setDescription('Agrega un jefe vencido')
        .addStringOption((o) => o.setName('name').setDescription('Nombre del jefe').setRequired(true))
    )
    .addSubcommand((s) => s.setName('boss_clear').setDescription('Borra la lista de jefes'))
    .addSubcommand((s) => s.setName('boss_list').setDescription('Lista jefes vencidos'))
    .addSubcommand((s) =>
      s
        .setName('event_add')
        .setDescription('Agrega un evento')
        .addStringOption((o) => o.setName('name').setDescription('Evento').setRequired(true))
    )
    .addSubcommand((s) => s.setName('event_clear').setDescription('Borra eventos'))
    .addSubcommand((s) => s.setName('event_list').setDescription('Lista eventos'))
    .addSubcommand((s) => s.setName('reload').setDescription('Recarga serverConfig.json desde disco'))
    .addSubcommand((s) => s.setName('export').setDescription('Descarga la config actual como archivo JSON')),

  async execute(interaction, ctx) {
    try {
      ensureAdmin(interaction);
      const sub = interaction.options.getSubcommand();
      const cfg = ctx.configStore.get();

      if (sub === 'show') {
        return interaction.reply({
          ephemeral: true,
          content: `\`\`\`json\n${JSON.stringify(prettyConfig(cfg), null, 2)}\n\`\`\``,
        });
      }

      if (sub === 'setip') {
        const ip = interaction.options.getString('ip', true);
        ctx.configStore.setPath(['ip'], ip);
        return interaction.reply({ ephemeral: true, content: `✅ IP actualizada a **${ip}**` });
      }

      if (sub === 'setport') {
        const port = interaction.options.getString('port', true);
        ctx.configStore.setPath(['port'], port);
        return interaction.reply({ ephemeral: true, content: `✅ Puerto actualizado a **${port}**` });
      }

      if (sub === 'rules') {
        const text = interaction.options.getString('text', true);
        ctx.configStore.setPath(['rules'], text);
        return interaction.reply({ ephemeral: true, content: `✅ Reglas actualizadas.` });
      }

      if (sub === 'context_add') {
        const text = interaction.options.getString('text', true);
        cfg.context = cfg.context || [];
        cfg.context.push(text);
        ctx.configStore.save();
        return interaction.reply({ ephemeral: true, content: `🧠 Contexto agregado.` });
      }

      if (sub === 'context_clear') {
        cfg.context = [];
        ctx.configStore.save();
        return interaction.reply({ ephemeral: true, content: `🧠 Contexto borrado.` });
      }

      if (sub === 'context_list') {
        const lines = (cfg.context || []).map((l, i) => `${i + 1}. ${l}`);
        const payload = lines.join('\n') || '(vacío)';

        // Discord tiene límite de 2000 chars: si es muy grande, lo enviamos como archivo.
        if (payload.length <= 1800) {
          return interaction.reply({ ephemeral: true, content: `**Contexto:**\n${payload}` });
        }

        const buf = Buffer.from(payload, 'utf8');
        return interaction.reply({
          ephemeral: true,
          content: `📎 Contexto adjunto (${lines.length} líneas).`,
          files: [{ attachment: buf, name: 'context_list.txt' }],
        });
      }

      if (sub === 'boss_add') {
        const name = interaction.options.getString('name', true);
        cfg.bosses = cfg.bosses || [];
        cfg.bosses.push(name);
        ctx.configStore.save();
        return interaction.reply({ ephemeral: true, content: `💀 Jefe agregado: **${name}**` });
      }

      if (sub === 'boss_clear') {
        cfg.bosses = [];
        ctx.configStore.save();
        return interaction.reply({ ephemeral: true, content: `✨ Lista de jefes borrada.` });
      }

      if (sub === 'boss_list') {
        const list = (cfg.bosses || []).join(', ') || 'Ninguno';
        return interaction.reply({ ephemeral: true, content: `💀 Jefes vencidos: ${list}` });
      }

      if (sub === 'event_add') {
        const name = interaction.options.getString('name', true);
        cfg.events = cfg.events || [];
        cfg.events.push(name);
        ctx.configStore.save();
        return interaction.reply({ ephemeral: true, content: `📅 Evento agregado: **${name}**` });
      }

      if (sub === 'event_clear') {
        cfg.events = [];
        ctx.configStore.save();
        return interaction.reply({ ephemeral: true, content: `🗑️ Eventos borrados.` });
      }

      if (sub === 'event_list') {
        const list = (cfg.events || []).join(', ') || 'Ninguno';
        return interaction.reply({ ephemeral: true, content: `📅 Próximos eventos: ${list}` });
      }

      if (sub === 'reload') {
        ctx.configStore.reload();
        return interaction.reply({ ephemeral: true, content: `🔄 Configuración recargada desde disco.` });
      }

      if (sub === 'export') {
        const cfgNow = ctx.configStore.get();
        const json = JSON.stringify(cfgNow, null, 2);
        return interaction.reply({
          ephemeral: true,
          content: '📎 Config adjunta (JSON).',
          files: [{ attachment: Buffer.from(json, 'utf8'), name: 'serverConfig.json' }],
        });
      }

      return interaction.reply({ ephemeral: true, content: 'Comando no implementado.' });
    } catch (err) {
      const msg = err?.message || String(err);
      if (interaction.replied || interaction.deferred) {
        return interaction.followUp({ ephemeral: true, content: msg });
      }
      return interaction.reply({ ephemeral: true, content: msg });
    }
  },
};
