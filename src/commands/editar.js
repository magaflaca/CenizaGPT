// src/commands/editar.js
const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { editImage } = require('../pollinations/pollinationsBridge');
const {
  canUseNanobanana,
  consumeNanobanana,
  remainingNanobanana,
  canUseNanobananaGlobal,
  consumeNanobananaGlobal,
  remainingNanobananaGlobal,
} = require('../pollinations/usageLimits');
const { fallbackEditToGenerate } = require('../pollinations/fallbackEdit');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('editar')
    .setDescription('Edita una imagen. Nanoceniza Pro (nanobanana) tiene límites (2/día y global 15/día).')
    // REQUIRED primero
    .addStringOption((o) => o.setName('prompt').setDescription('Qué cambio quieres hacer').setRequired(true))
    // opcionales después
    .addAttachmentOption((o) => o.setName('file').setDescription('Adjunta imagen a editar').setRequired(false))
    .addStringOption((o) => o.setName('url').setDescription('URL de imagen a editar').setRequired(false))
    .addIntegerOption((o) => o.setName('seed').setDescription('Seed (opcional)').setRequired(false))
    .addIntegerOption((o) => o.setName('width').setDescription('Ancho (opcional)').setRequired(false))
    .addIntegerOption((o) => o.setName('height').setDescription('Alto (opcional)').setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply();

    const prompt = interaction.options.getString('prompt');
    const file = interaction.options.getAttachment('file');
    const url = interaction.options.getString('url');
    const seed = interaction.options.getInteger('seed') || 0;
    const width = interaction.options.getInteger('width') || 1024;
    const height = interaction.options.getInteger('height') || 1024;

    const imageUrl = file?.url || url;
    if (!imageUrl) {
      await interaction.editReply('Adjunta una imagen o pasa una URL directa.');
      return;
    }

    const userId = interaction.user.id;

    const okUser = canUseNanobanana(userId);
    const okGlobal = canUseNanobananaGlobal();

    // 1) Si hay cupo => nanobanana
    if (okUser && okGlobal) {
      // Consumimos antes (para evitar race conditions)
      consumeNanobanana(userId);
      consumeNanobananaGlobal();

      try {
        const out = await editImage({
          imageUrl,
          prompt,
          modelId: process.env.POLLINATIONS_MODEL_NANOBANANA || 'nanobanana',
          seed,
          width,
          height,
        });

        if (!out || !out.ok || !out.buffer) {
          throw new Error('editImage devolvió un resultado inválido');
        }

        const leftUser = remainingNanobanana(userId);
        const leftGlobal = remainingNanobananaGlobal();
        const usedUser = 2 - leftUser;
        const usedGlobal = 15 - leftGlobal;

        const attachment = new AttachmentBuilder(out.buffer, { name: 'ceniza_edit.png' });

        await interaction.editReply({
          content:
            `✏️ **Edición (Nanoceniza Pro)** | Seed: ${out.seed ?? seed}\n` +
            `**Uso hoy:** ${usedUser}/2 (usuario) | ${usedGlobal}/15 (global)`,
          files: [attachment],
        });
        return;
      } catch (e) {
        console.error('[editar] nanobanana edit error:', e);
        // Si falla nanobanana aunque haya cupo, hacemos fallback para no dejarlo colgado
      }
    }

    // 2) Sin cupo o nanobanana falló => fallback regenerativo
    const leftUser = remainingNanobanana(userId);
    const leftGlobal = remainingNanobananaGlobal();
    const usedUser = 2 - leftUser;
    const usedGlobal = 15 - leftGlobal;

    try {
      const fb = await fallbackEditToGenerate({
        imageUrl,
        userPrompt: prompt,
        seed,
        width,
        height,
      });

      await interaction.editReply({
        content:
          `⚠️ **Nanoceniza Pro no disponible ahora** (usuario ${usedUser}/2 · global ${usedGlobal}/15).\n` +
          `Hice un fallback recreando la imagen + aplicando tu edición.\n` +
          `**Modelo:** ${fb.modelLabel} | **Seed:** ${fb.seed}`,
        files: [fb.attachment],
      });
      return;
    } catch (e) {
      console.error('[editar:fallback] Error:', e);
      await interaction.editReply(
        `⚠️ No pude editar ahora mismo (Nanoceniza Pro sin cupo o falló, y el fallback también falló).`
      );
    }
  },
};
