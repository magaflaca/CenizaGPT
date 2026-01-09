const { SlashCommandBuilder } = require('discord.js');
const { analyzeVideo } = require('../services/videoBridge');
const fs = require('fs');
const path = require('path');
const https = require('https');
const os = require('os');

// Helper para descargar attachment a temp
async function downloadAttachment(url, ext) {
    const tempPath = path.join(os.tmpdir(), `ceniza_vid_${Date.now()}.${ext}`);
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(tempPath);
        https.get(url, (response) => {
            response.pipe(file);
            file.on('finish', () => {
                file.close(() => resolve(tempPath));
            });
        }).on('error', (err) => {
            fs.unlink(tempPath, () => { });
            reject(err);
        });
    });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('video')
        .setDescription('Analiza un video o audio y responde a tu pregunta')
        .addStringOption((o) => o.setName('prompt').setDescription('¿Qué querés saber?').setRequired(true))
        .addStringOption((o) => o.setName('link').setDescription('URL del video (Youtube, etc)'))
        .addAttachmentOption((o) => o.setName('file').setDescription('Archivo de audio/video')),

    async execute(interaction, ctx) {
        const prompt = interaction.options.getString('prompt', true);
        const link = interaction.options.getString('link');
        const attachment = interaction.options.getAttachment('file');

        if (!link && !attachment) {
            return interaction.reply({ content: '⚠️ Tenés que poner un **link** o subir un **archivo**.', ephemeral: true });
        }

        await interaction.deferReply();

        let tempFile = null;

        try {
            let result = '';

            if (link) {
                result = await analyzeVideo({
                    mode: 'url',
                    input: link,
                    prompt,
                    model: ctx.models.smart // Usa el modelo mas capaz (70b)
                });
            } else if (attachment) {
                // Validar tipo (opcional, pero py bridge ya chequea si puede procesarlo)
                const ext = attachment.name.split('.').pop();
                tempFile = await downloadAttachment(attachment.url, ext);

                result = await analyzeVideo({
                    mode: 'file',
                    input: tempFile,
                    prompt,
                    model: ctx.models.smart
                });
            }

            // Cortar respuesta si excede límite de Discord
            if (result.length > 1950) {
                result = result.slice(0, 1950) + '... (cortado)';
            }

            await interaction.editReply(result);

        } catch (e) {
            console.error('[video] Error:', e);
            let msg = '⚠️ Hubo un error procesando el video.';
            if (e.message.includes('transcription')) msg += ' (Falló la transcripción)';
            if (e.message.includes('No such file')) msg += ' (No pude descargar el archivo)';

            await interaction.editReply(`${msg}\nErr: \`${e.message}\``);
        } finally {
            // Limpiar temp
            if (tempFile && fs.existsSync(tempFile)) {
                fs.unlink(tempFile, () => { });
            }
        }
    },
};
