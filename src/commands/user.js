const { SlashCommandBuilder } = require('discord.js');
const { buildMemberInfo, buildAvatarEmbed } = require('../services/serverInspector');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('user')
    .setDescription('Info de usuarios')
    .addSubcommand((s) =>
      s
        .setName('info')
        .setDescription('Muestra roles y datos públicos de un usuario')
        .addUserOption((o) => o.setName('user').setDescription('Usuario').setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName('avatar')
        .setDescription('Muestra el avatar de un usuario')
        .addUserOption((o) => o.setName('user').setDescription('Usuario').setRequired(true))
    ),

  async execute(interaction, ctx) {
    const sub = interaction.options.getSubcommand();
    if (!interaction.guild) {
      return interaction.reply({ ephemeral: true, content: 'Este comando solo funciona en servidores.' });
    }

    const user = interaction.options.getUser('user', true);
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) {
      return interaction.reply({ ephemeral: true, content: 'No pude obtener ese miembro en el servidor.' });
    }

      const info = buildMemberInfo(member, interaction.channel);
    if (!info) {
      return interaction.reply({ ephemeral: true, content: 'No pude leer info de ese miembro.' });
    }

    if (sub === 'avatar') {
      const embed = buildAvatarEmbed(member, { title: `Avatar de ${info.displayName}` });
      return interaction.reply({ ephemeral: true, content: `👤 ${info.mention}`, embeds: embed ? [embed] : [] });
    }

    if (sub === 'info') {
      const lines = [];
      lines.push(`👤 **Usuario:** ${info.mention}`);
      lines.push(`- Apodo (server): **${info.displayName}**`);
      lines.push(`- Usuario: **${info.username}**`);
      lines.push(`- Rol más alto: **${info.topRole}**`);
      lines.push(`- Roles (${info.roleCount}): ${info.roleMentions.length ? info.roleMentions.join(' ') : '(solo @everyone)'}`);
      if (info.joinedAt) lines.push(`- Entró al server: <t:${Math.floor(info.joinedAt.getTime() / 1000)}:R>`);
      if (info.createdAt) lines.push(`- Cuenta creada: <t:${Math.floor(info.createdAt.getTime() / 1000)}:R>`);
      lines.push('- Bio: Discord no expone la biografía (About Me) a bots con la API estándar.');

      return interaction.reply({ ephemeral: true, content: lines.join('\n').slice(0, 1900) });
    }

    return interaction.reply({ ephemeral: true, content: 'Subcomando no implementado.' });
  },
};
