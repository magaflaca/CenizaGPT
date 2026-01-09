const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reset')
    .setDescription('Olvida conversación (sin perder serverConfig.json)')
    .addStringOption((o) =>
      o
        .setName('scope')
        .setDescription('Qué querés resetear')
        .setRequired(true)
        .addChoices(
          { name: 'Solo mi contexto (item/caches)', value: 'me' },
          { name: 'Historial del canal', value: 'channel' }
        )
    ),

  async execute(interaction, ctx) {
    const scope = interaction.options.getString('scope', true);
    const guildId = interaction.guildId;
    const channelId = interaction.channelId;
    const userId = interaction.user?.id;

    if (scope === 'me') {
      ctx.memoryStore.resetUser({ guildId, userId });
      return interaction.reply({ ephemeral: true, content: '✅ Listo: olvidé tu contexto (item/caches).' });
    }

    if (scope === 'channel') {
      if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ ephemeral: true, content: '❌ Solo admins pueden resetear el historial del canal.' });
      }
      ctx.memoryStore.resetChannel({ guildId, channelId });
      return interaction.reply({ ephemeral: true, content: '✅ Listo: olvidé el historial del canal.' });
    }

    return interaction.reply({ ephemeral: true, content: 'Scope inválido.' });
  },
};
