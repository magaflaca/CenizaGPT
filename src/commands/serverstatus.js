const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const net = require('net');

function pingTcp(host, port, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = new net.Socket();
    let done = false;

    const finish = (ok) => {
      if (done) return;
      done = true;
      try { socket.destroy(); } catch (_e) {}
      resolve({ ok, ms: Date.now() - start });
    };

    socket.setTimeout(timeoutMs);
    socket.on('connect', () => finish(true));
    socket.on('timeout', () => finish(false));
    socket.on('error', () => finish(false));

    socket.connect(Number(port), host);
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('serverstatus')
    .setDescription('Comprueba si el servidor de Terraria parece estar online (TCP)')
    .addIntegerOption((o) => o.setName('timeout_ms').setDescription('Timeout (ms)').setRequired(false).setMinValue(500).setMaxValue(8000)),

  async execute(interaction, ctx) {
    const cfg = ctx.configStore.get();
    const host = cfg.ip;
    const port = cfg.port;
    const timeoutMs = interaction.options.getInteger('timeout_ms') || 2500;

    await interaction.deferReply({ ephemeral: true });
    const res = await pingTcp(host, port, timeoutMs);

    const embed = new EmbedBuilder()
      .setTitle('Estado del servidor Terraria')
      .addFields(
        { name: 'Host', value: String(host), inline: true },
        { name: 'Puerto', value: String(port), inline: true },
        { name: 'Resultado', value: res.ok ? '🟢 Conexión TCP OK' : '🔴 No responde (o bloqueado)', inline: false },
        { name: 'Latencia', value: `${res.ms}ms`, inline: true }
      )
      .setFooter({ text: 'Nota: esto solo prueba TCP, no consulta el protocolo interno de Terraria.' });

    return interaction.editReply({ embeds: [embed] });
  },
};
