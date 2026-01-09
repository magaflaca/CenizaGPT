const { SlashCommandBuilder, ChannelType } = require('discord.js');
const { analyzeTextChannel, isPublicChannel } = require('../services/serverInspector');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('channel')
    .setDescription('Inspección de un canal')
    .addSubcommand((s) =>
      s
        .setName('info')
        .setDescription('Analiza (ligeramente) un canal de texto público')
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Canal a analizar')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        )
    ),

  async execute(interaction, ctx) {
    const sub = interaction.options.getSubcommand();
    if (sub !== 'info') {
      return interaction.reply({ ephemeral: true, content: 'Subcomando no implementado.' });
    }

    const ch = interaction.options.getChannel('channel', true);
    if (!interaction.guild) {
      return interaction.reply({ ephemeral: true, content: 'Este comando solo funciona en servidores.' });
    }

    // Solo describimos canales públicos para @everyone (evita fugas)
    if (!isPublicChannel(ch, interaction.guild)) {
      return interaction.reply({ ephemeral: true, content: 'Ese canal no parece ser público para @everyone, así que no lo describo.' });
    }

    await interaction.deferReply({ ephemeral: true });

    const analysis = await analyzeTextChannel(ch, { limit: 50 });
    if (!analysis.ok) {
      return interaction.editReply({ content: `No pude analizar el canal: ${analysis.error}` });
    }

    const lines = [];
    lines.push(`📌 **${ch.toString()}**`);
    if (analysis.topic) lines.push(`- Tema/Descripción: ${analysis.topic.slice(0, 300)}`);

    if (analysis.purposeSummary) {
      lines.push(`🧭 ${analysis.purposeSummary}`.slice(0, 1800));
    } else if (analysis.looksLikeCounting) {
      lines.push('- Parece un canal de **conteo** (números consecutivos).');
    } else {
      lines.push(`- Muestras analizadas: ${analysis.totalSamples}`);
      lines.push(`- Mensajes con links (aprox): ${analysis.linkCount}`);
    }
return interaction.editReply({ content: lines.join('\n').slice(0, 1900) });
  },
};
