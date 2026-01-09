const { SlashCommandBuilder } = require('discord.js');
const { answerAboutItem } = require('../services/terrariaChat');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('item')
    .setDescription('Busca items de Terraria (usa items.json y wiki)')
    .addSubcommand((s) =>
      s
        .setName('info')
        .setDescription('Resumen/Info de un item')
        .addStringOption((o) => o.setName('name').setDescription('Nombre del item').setRequired(true).setAutocomplete(true))
    )

    .addSubcommand((s) =>
      s
        .setName('ask')
        .setDescription('Pregunta sobre un item (usa wiki)')
        // REQUIRED primero (regla de Discord)
        .addStringOption((o) => o.setName('question').setDescription('Tu pregunta').setRequired(true))
        // Opcional después
        .addStringOption((o) =>
          o
            .setName('name')
            .setDescription('Nombre o ID del item (opcional si ya hay item activo)')
            .setRequired(false)
	    .setAutocomplete(true) // ✅
        )
    )
    .addSubcommand((s) =>
      s
        .setName('clear')
        .setDescription('Olvida el item activo (por usuario)')
    ),

  async execute(interaction, ctx) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    const userId = interaction.user.id;

    if (sub === 'clear') {
      const state = ctx.memoryStore.getUserState({ guildId, userId });
      ctx.memoryStore.setUserState({ guildId, userId, patch: { ...state, activeItem: null } });
      return interaction.reply({ ephemeral: true, content: '✅ Item activo olvidado.' });
    }

    if (sub === 'ask') {
      const question = interaction.options.getString('question', true);
      const nameOpt = interaction.options.getString('name', false);

      // Resolver item por nombre/id o usar item activo
      let item = null;
      let displayQuery = '';

      if (nameOpt && String(nameOpt).trim()) {
        const q = String(nameOpt).trim();
        displayQuery = q;
        if (/^\d{1,5}$/.test(q)) {
          const byId = ctx.itemsIndex.findById(Number(q));
          if (byId) item = byId;
        }
        if (!item) {
          const best = ctx.itemsIndex.findBest(q, { strict: false });
          if (best && best.item) item = best.item;
        }
      } else {
        // usar item activo
        const st = ctx.memoryStore.getUserState({ guildId, userId });
        if (st?.activeItem?.itemRef) {
          // reconstruir un objeto item mínimo compatible
          item = st.activeItem.itemRef;
          displayQuery = st.activeItem.name || '';
        }
      }

      if (!item) {
        return interaction.reply({
          ephemeral: true,
          content:
            'No tengo un item activo y no me diste el nombre. Usá **/item ask name:<item> question:<pregunta>** o primero **/item info**.',
        });
      }

      await interaction.deferReply();
      const text = await answerAboutItem({
        memoryStore: ctx.memoryStore,
        guildId,
        userId,
        item,
        userText: question,
        includeTip: false,
        preferSpanish: true,
      });

      // Si el módulo decide no manejarlo, respondemos algo seguro
      if (text == null) {
        return interaction.editReply({
          content: `No pude asociar tu pregunta a un item en este contexto. Probá con **/item info ${displayQuery || '<item>'}** primero.`,
        });
      }

      // Discord límite: partir en chunks
      const parts = [];
      let rest = String(text || '');
      while (rest.length > 0) {
        parts.push(rest.slice(0, 1900));
        rest = rest.slice(1900);
        if (parts.length >= 4) break;
      }

      await interaction.editReply({ content: parts[0] });
      for (let i = 1; i < parts.length; i++) {
        await interaction.followUp({ content: parts[i] });
      }
      return;
    }

    if (sub === 'info') {
      const name = interaction.options.getString('name', true);
      // Permitir ID numérico o fuzzy por nombre
      let match = null;
      const q = String(name).trim();
      if (/^\d{1,5}$/.test(q)) {
        const byId = ctx.itemsIndex.findById(Number(q));
        if (byId) match = { item: byId, score: 0, method: 'id' };
      }
      if (!match) {
        match = ctx.itemsIndex.findBest(name, { strict: false });
      }
      if (!match) {
        return interaction.reply({
          content: 'No encontré ese item en items.json. Probá con el nombre en inglés o más exacto.',
          ephemeral: true,
        });
      }

      await interaction.deferReply();
      const text = await answerAboutItem({
        memoryStore: ctx.memoryStore,
        guildId,
        userId,
        item: match.item,
        userText: name,
        includeTip: true,
        preferSpanish: true,
      });

      if (text == null) {
        return interaction.editReply({
          content: 'No pude generar información del item en este momento. Probá de nuevo o pegá el link exacto de la wiki.',
        });
      }

      // Discord límite: partir en chunks
      const parts = [];
      let rest = String(text || '');
      while (rest.length > 0) {
        parts.push(rest.slice(0, 1900));
        rest = rest.slice(1900);
        if (parts.length >= 4) break;
      }

      await interaction.editReply({ content: parts[0] });
      for (let i = 1; i < parts.length; i++) {
        await interaction.followUp({ content: parts[i] });
      }
      return;
    }

    return interaction.reply({ ephemeral: true, content: 'Subcomando no implementado.' });
  },
};
