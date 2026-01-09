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
    .setName('kick')
    .setDescription('Expulsa a un usuario (con confirmación)')
    .addUserOption((o) => o.setName('user').setDescription('Usuario').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Razón').setRequired(false)),

  async execute(interaction, ctx) {
    if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.KickMembers) &&
        !interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ ephemeral: true, content: '❌ No tienes permisos para expulsar.' });
    }

    const target = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason') || '';

    const id = ctx.confirmStore.create({
      requesterId: interaction.user.id,
      action: {
        type: 'kick',
        targetUser: target.id,
        reason,
      },
      context: {
        guildId: interaction.guildId,
        channelId: interaction.channelId,
      },
    });

    const embed = new EmbedBuilder()
      .setTitle('Confirmación requerida')
      .setDescription('Vas a expulsar al usuario indicado. ¿Confirmas?')
      .addFields(
        { name: 'Acción', value: 'kick', inline: true },
        { name: 'Objetivo', value: `<@${target.id}>`, inline: true },
        { name: 'Razón', value: reason || '(sin razón)', inline: false }
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`confirm:${id}`).setLabel('Confirmar').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`cancel:${id}`).setLabel('Cancelar').setStyle(ButtonStyle.Secondary)
    );

    return interaction.reply({ ephemeral: true, embeds: [embed], components: [row] });
  },
};
