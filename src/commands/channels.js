const { SlashCommandBuilder } = require('discord.js');
const { formatPublicChannelList } = require('../services/serverInspector');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('channels')
    .setDescription('Herramientas para canales')
    .addSubcommand((s) => s.setName('list').setDescription('Lista canales públicos (VIEW_CHANNEL para @everyone)')),

  async execute(interaction, ctx) {
    const sub = interaction.options.getSubcommand();
    if (sub !== 'list') {
      return interaction.reply({ ephemeral: true, content: 'Subcomando no implementado.' });
    }

    const list = formatPublicChannelList(interaction.guild);
    if (list.length <= 1800) {
      return interaction.reply({ ephemeral: true, content: list });
    }

    const buf = Buffer.from(list, 'utf8');
    return interaction.reply({
      ephemeral: true,
      content: '📎 Lista de canales públicos adjunta.',
      files: [{ attachment: buf, name: 'canales_publicos.txt' }],
    });
  },
};
