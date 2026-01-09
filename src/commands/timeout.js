const {
  SlashCommandBuilder,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');

const { parseDurationMs } = require('../services/actionParser');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Silencia (timeout) a un usuario (con confirmación)')
    .addSubcommand((s) =>
      s
        .setName('set')
        .setDescription('Aplica timeout')
        .addUserOption((o) => o.setName('user').setDescription('Usuario').setRequired(true))
        .addStringOption((o) => o.setName('duration').setDescription('Duración, ej: 10m, 1h, 2d').setRequired(true))
        .addStringOption((o) => o.setName('reason').setDescription('Razón').setRequired(false))
    )
    .addSubcommand((s) =>
      s
        .setName('clear')
        .setDescription('Quita timeout')
        .addUserOption((o) => o.setName('user').setDescription('Usuario').setRequired(true))
        .addStringOption((o) => o.setName('reason').setDescription('Razón').setRequired(false))
    ),

  async execute(interaction, ctx) {
    if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ModerateMembers) &&
        !interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ ephemeral: true, content: '❌ No tienes permisos para aplicar timeout.' });
    }

    const sub = interaction.options.getSubcommand();
    const target = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason') || '';

    let durationMs = 0;
    if (sub === 'set') {
      const durationText = interaction.options.getString('duration', true);
      durationMs = parseDurationMs(durationText);
      if (!durationMs) {
        return interaction.reply({ ephemeral: true, content: 'Duración inválida. Ejemplos: 10m, 1h, 2d.' });
      }
    }

    const id = ctx.confirmStore.create({
      requesterId: interaction.user.id,
      action: {
        type: 'timeout',
        targetUser: target.id,
        durationMs,
        reason,
      },
      context: {
        guildId: interaction.guildId,
        channelId: interaction.channelId,
      },
    });

    const embed = new EmbedBuilder()
      .setTitle('Confirmación requerida')
      .setDescription(sub === 'set'
        ? 'Vas a aplicar timeout al usuario indicado. ¿Confirmas?'
        : 'Vas a quitar el timeout al usuario indicado. ¿Confirmas?'
      )
      .addFields(
        { name: 'Acción', value: 'timeout', inline: true },
        { name: 'Objetivo', value: `<@${target.id}>`, inline: true },
        { name: 'Duración', value: sub === 'set' ? `${Math.round(durationMs / 60000)} min (aprox)` : 'remover', inline: true },
        { name: 'Razón', value: reason || '(sin razón)', inline: false }
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`confirm:${id}`).setLabel('Confirmar').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`cancel:${id}`).setLabel('Cancelar').setStyle(ButtonStyle.Secondary)
    );

    return interaction.reply({ ephemeral: true, embeds: [embed], components: [row] });
  },
};
