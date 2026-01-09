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
    .setName('ban')
    .setDescription('Banea a un usuario (con confirmación)')
    .addUserOption((o) => o.setName('user').setDescription('Usuario').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Razón').setRequired(false))
    .addIntegerOption((o) =>
      o
        .setName('delete_messages_seconds')
        .setDescription('Borrar mensajes recientes (segundos)')
        .setRequired(false)
        .setMinValue(0)
        .setMaxValue(604800)
    ),

  async execute(interaction, ctx) {
    if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.BanMembers) &&
        !interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ ephemeral: true, content: '❌ No tienes permisos para banear.' });
    }

    const target = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason') || '';
    const deleteSecs = interaction.options.getInteger('delete_messages_seconds') || 0;

    const id = ctx.confirmStore.create({
      requesterId: interaction.user.id,
      action: {
        type: 'ban',
        targetUser: target.id,
        reason,
        deleteMessageSeconds: deleteSecs,
      },
      context: {
        guildId: interaction.guildId,
        channelId: interaction.channelId,
      },
    });

    const embed = new EmbedBuilder()
      .setTitle('Confirmación requerida')
      .setDescription('Vas a banear al usuario indicado. ¿Confirmas?')
      .addFields(
        { name: 'Acción', value: 'ban', inline: true },
        { name: 'Objetivo', value: `<@${target.id}>`, inline: true },
        { name: 'Borrar mensajes', value: `${deleteSecs}s`, inline: true },
        { name: 'Razón', value: reason || '(sin razón)', inline: false }
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`confirm:${id}`).setLabel('Confirmar').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`cancel:${id}`).setLabel('Cancelar').setStyle(ButtonStyle.Secondary)
    );

    return interaction.reply({ ephemeral: true, embeds: [embed], components: [row] });
  },
};
