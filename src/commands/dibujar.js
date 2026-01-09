// src/commands/dibujar.js
const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { generateImage } = require('../pollinations/pollinationsBridge');
const {
  canUseNanobananaGen,
  consumeNanobananaGen,
  remainingNanobananaGen,
  canUseNanobananaGlobal,
  consumeNanobananaGlobal,
  remainingNanobananaGlobal,
} = require('../pollinations/usageLimits');

function mapUserModelToId(userChoice) {
  const flux = process.env.POLLINATIONS_MODEL_FLUX || 'flux';
  const zimage = process.env.POLLINATIONS_MODEL_ZIMAGE || 'zimage';
  const turbo = process.env.POLLINATIONS_MODEL_TURBO || 'turbo';
  const nano = process.env.POLLINATIONS_MODEL_NANOBANANA || 'nanobanana';

  const c = String(userChoice || 'fluxeniza').toLowerCase();
  if (c === 'zeniza') return { id: zimage, label: 'Zeniza', kind: 'normal' };
  if (c === 'ceniturbo') return { id: turbo, label: 'Ceniturbo', kind: 'normal' };
  if (c === 'nanoceniza pro') return { id: nano, label: 'Nanoceniza Pro', kind: 'nano' };
  return { id: flux, label: 'Fluxeniza', kind: 'normal' };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dibujar')
    .setDescription('Genera una imagen con Fluxeniza/Zeniza/Ceniturbo o Nanoceniza Pro (limitado).')
    // required primero
    .addStringOption((o) => o.setName('prompt').setDescription('Qué quieres dibujar').setRequired(true))
    // luego opcionales
    .addStringOption((o) =>
      o.setName('modelo')
        .setDescription('Modelo')
        .addChoices(
          { name: 'Fluxeniza', value: 'fluxeniza' },
          { name: 'Zeniza', value: 'zeniza' },
          { name: 'Ceniturbo', value: 'ceniturbo' },
          { name: 'Nanoceniza Pro (1/día)', value: 'nanoceniza pro' },
        )
        .setRequired(false)
    )
    .addIntegerOption((o) => o.setName('seed').setDescription('Seed (opcional)').setRequired(false))
    .addIntegerOption((o) => o.setName('size').setDescription('Tamaño 512 o 1024').setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply();

    const prompt = interaction.options.getString('prompt');
    const modeloChoice = interaction.options.getString('modelo') || 'fluxeniza';
    const seed = interaction.options.getInteger('seed') || 0;
    const size = interaction.options.getInteger('size') || 1024;

    const { id: modelId, label, kind } = mapUserModelToId(modeloChoice);

    // Nanoceniza Pro: aplicar límites (1/día usuario + global 15/día)
    if (kind === 'nano') {
      const uid = interaction.user.id;

      const okUser = canUseNanobananaGen(uid);
      const okGlobal = canUseNanobananaGlobal();

      if (!okUser || !okGlobal) {
        const leftUser = remainingNanobananaGen(uid);
        const leftGlobal = remainingNanobananaGlobal();
        await interaction.editReply(
          `⚠️ **Nanoceniza Pro no disponible ahora**.\n` +
          `Restante hoy: **${leftUser}/1** (usuario) · **${leftGlobal}/15** (global)`
        );
        return;
      }

      // Consumir antes para evitar race
      consumeNanobananaGen(uid);
      consumeNanobananaGlobal();
    }

    const width = size === 512 ? 512 : 1024;
    const height = width;

    try {
      const out = await generateImage({ prompt, modelId, seed, width, height });

      if (!out || !out.ok || !out.buffer) {
        throw new Error('generateImage devolvió resultado inválido');
      }

      const attachment = new AttachmentBuilder(out.buffer, { name: 'ceniza.png' });

      await interaction.editReply({
        content: `🖼️ **Modelo:** ${label} | **Seed:** ${out.seed ?? seed}\n**Prompt:** ${String(prompt).slice(0, 800)}`.slice(0, 1900),
        files: [attachment],
      });
    } catch (e) {
      console.error('[dibujar] Error:', e);
      await interaction.editReply('⚠️ No pude generar la imagen ahora mismo.');
    }
  },
};
