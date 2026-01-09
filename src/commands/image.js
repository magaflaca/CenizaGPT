// src/commands/image.js
const { SlashCommandBuilder } = require('discord.js');
const { imageDescribe, imageAsk, imageOCR, imageAnalyze } = require('../vision/imageBridge');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('image')
    .setDescription('Analiza imágenes (visión)')
    .addSubcommand((s) =>
      s
        .setName('describe')
        .setDescription('Describe una imagen')
        // Opcionales
        .addAttachmentOption((o) => o.setName('file').setDescription('Adjunta una imagen').setRequired(false))
        .addStringOption((o) => o.setName('url').setDescription('URL de imagen').setRequired(false))
        .addStringOption((o) => o.setName('prompt').setDescription('Instrucción extra (opcional)').setRequired(false))
    )
    .addSubcommand((s) =>
      s
        .setName('ask')
        .setDescription('Pregunta sobre una imagen')
        // REQUIRED primero
        .addStringOption((o) => o.setName('question').setDescription('Tu pregunta').setRequired(true))
        // Opcionales después
        .addAttachmentOption((o) => o.setName('file').setDescription('Adjunta una imagen').setRequired(false))
        .addStringOption((o) => o.setName('url').setDescription('URL de imagen').setRequired(false))
    )
    .addSubcommand((s) =>
      s
        .setName('text')
        .setDescription('Extrae texto visible (OCR por visión)')
        // Opcionales
        .addAttachmentOption((o) => o.setName('file').setDescription('Adjunta una imagen').setRequired(false))
        .addStringOption((o) => o.setName('url').setDescription('URL de imagen').setRequired(false))
        .addStringOption((o) => o.setName('hint').setDescription('Qué buscar (opcional)').setRequired(false))
    )
    .addSubcommand((s) =>
      s
        .setName('analyze')
        .setDescription('Análisis estructurado (JSON)')
        // Opcionales
        .addAttachmentOption((o) => o.setName('file').setDescription('Adjunta una imagen').setRequired(false))
        .addStringOption((o) => o.setName('url').setDescription('URL de imagen').setRequired(false))
        .addStringOption((o) => o.setName('hint').setDescription('Instrucción extra (opcional)').setRequired(false))
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const sub = interaction.options.getSubcommand();
    const file = interaction.options.getAttachment('file');
    const url = interaction.options.getString('url');

    const prompt = interaction.options.getString('prompt') || '';
    const question = interaction.options.getString('question') || '';
    const hint = interaction.options.getString('hint') || '';

    const src = file?.url || url;

    if (!src) {
      await interaction.editReply('Adjunta una imagen o pasa una URL válida.');
      return;
    }

    try {
      let out = '';
      if (sub === 'describe') out = await imageDescribe(src, prompt);
      else if (sub === 'ask') out = await imageAsk(src, question);
      else if (sub === 'text') out = await imageOCR(src, hint);
      else if (sub === 'analyze') out = await imageAnalyze(src, hint);
      else out = 'Subcomando no soportado.';

      if (out.length > 1800) out = out.slice(0, 1800) + '\n\n…(recortado)';
      await interaction.editReply(out);
    } catch (e) {
      console.error('[image] Error:', e);
      await interaction.editReply('No pude analizar esa imagen ahora mismo.');
    }
  },
};
