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
    .setName('nickname')
    .setDescription('Cambia el apodo de un usuario (con confirmación)')
    .addUserOption((o) => o.setName('user').setDescription('Usuario').setRequired(true))
    .addStringOption((o) => o.setName('nickname').setDescription('Nuevo apodo').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Razón').setRequired(false)),

  async execute(interaction, ctx) {
    if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageNicknames) &&
        !interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ ephemeral: true, content: '❌ No tienes permisos para cambiar apodos.' });
    }

    const target = interaction.options.getUser('user', true);
    const nickname = interaction.options.getString('nickname', true).slice(0, 32);
    const reason = interaction.options.getString('reason') || '';

    const id = ctx.confirmStore.create({
      requesterId: interaction.user.id,
      action: {
        type: 'nickname_set',
        targetUser: target.id,
        newNickname: nickname,
        reason,
      },
      context: {
        guildId: interaction.guildId,
        channelId: interaction.channelId,
      },
    });

    const embed = new EmbedBuilder()
      .setTitle('Confirmación requerida')
      .setDescription('Vas a cambiar el apodo. ¿Confirmas?')
      .addFields(
        { name: 'Acción', value: 'nickname_set', inline: true },
        { name: 'Objetivo', value: `<@${target.id}>`, inline: true },
        { name: 'Nuevo apodo', value: nickname, inline: true },
        { name: 'Razón', value: reason || '(sin razón)', inline: false }
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`confirm:${id}`).setLabel('Confirmar').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`cancel:${id}`).setLabel('Cancelar').setStyle(ButtonStyle.Secondary)
    );

    return interaction.reply({ ephemeral: true, embeds: [embed], components: [row] });
  },
};
