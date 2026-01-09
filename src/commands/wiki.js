const { SlashCommandBuilder } = require('discord.js');
const { terrariaSummarize, terrariaAsk } = require('../terraria/terrariaBridge');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('wiki')
    .setDescription('Herramientas para resumir/consultar artículos de la wiki de Terraria')
    .addSubcommand((s) =>
      s
        .setName('summarize')
        .setDescription('Resume una página de la wiki (url)')
        .addStringOption((o) => o.setName('url').setDescription('URL de la wiki').setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName('ask')
        .setDescription('Hace una pregunta sobre una página de la wiki (url)')
        .addStringOption((o) => o.setName('url').setDescription('URL de la wiki').setRequired(true))
        .addStringOption((o) => o.setName('question').setDescription('Pregunta').setRequired(true))
    ),

  async execute(interaction, ctx) {
    const sub = interaction.options.getSubcommand();
    const url = interaction.options.getString('url', true);

    await interaction.deferReply();

    try {
      if (sub === 'summarize') {
        const ans = await terrariaSummarize(url);
        return interaction.editReply({ content: ans.slice(0, 1900) });
      }
      if (sub === 'ask') {
        const q = interaction.options.getString('question', true);
        const ans = await terrariaAsk(url, q);
        return interaction.editReply({ content: ans.slice(0, 1900) });
      }
      return interaction.editReply({ content: 'Subcomando no implementado.' });
    } catch (e) {
      console.error('[wiki] Error consultando wiki:', e);
      return interaction.editReply({
        content: '⚠️ No pude consultar la wiki ahora mismo. Probá de nuevo en unos minutos o revisá que el link sea correcto.',
      });
    }
  },
};
