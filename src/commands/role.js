const {
  SlashCommandBuilder,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('role')
    .setDescription('Asigna o quita roles (con confirmación)')
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Asigna un rol')
        .addUserOption((o) => o.setName('user').setDescription('Usuario').setRequired(true))
        .addRoleOption((o) => o.setName('role').setDescription('Rol').setRequired(true))
        .addStringOption((o) => o.setName('reason').setDescription('Razón').setRequired(false))
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Quita un rol')
        .addUserOption((o) => o.setName('user').setDescription('Usuario').setRequired(true))
        .addRoleOption((o) => o.setName('role').setDescription('Rol').setRequired(true))
        .addStringOption((o) => o.setName('reason').setDescription('Razón').setRequired(false))
    ),

  async execute(interaction, ctx) {
    if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageRoles) &&
        !interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ ephemeral: true, content: '❌ No tienes permisos para gestionar roles.' });
    }

    const sub = interaction.options.getSubcommand();
    const target = interaction.options.getUser('user', true);
    const role = interaction.options.getRole('role', true);
    const reason = interaction.options.getString('reason') || '';

    const type = sub === 'remove' ? 'role_remove' : 'role_add';

    const id = ctx.confirmStore.create({
      requesterId: interaction.user.id,
      action: {
        type,
        targetUser: target.id,
        role: role.id,
        reason,
      },
      context: {
        guildId: interaction.guildId,
        channelId: interaction.channelId,
      },
    });

    const embed = new EmbedBuilder()
      .setTitle('Confirmación requerida')
      .setDescription('Vas a modificar roles. ¿Confirmas?')
      .addFields(
        { name: 'Acción', value: type, inline: true },
        { name: 'Objetivo', value: `<@${target.id}>`, inline: true },
        { name: 'Rol', value: `<@&${role.id}>`, inline: true },
        { name: 'Razón', value: reason || '(sin razón)', inline: false }
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`confirm:${id}`).setLabel('Confirmar').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`cancel:${id}`).setLabel('Cancelar').setStyle(ButtonStyle.Secondary)
    );

    return interaction.reply({ ephemeral: true, embeds: [embed], components: [row] });
  },
};
