require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');

const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;
const token = process.env.DISCORD_TOKEN;

if (!clientId || !guildId || !token) {
  console.error('Faltan DISCORD_CLIENT_ID / DISCORD_GUILD_ID / DISCORD_TOKEN en .env');
  process.exit(1);
}

const commandsPath = path.join(__dirname, '..', 'src', 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'));

const commands = [];
for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if (command?.data?.toJSON) {
    commands.push(command.data.toJSON());
  }
}

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    console.log(`Registrando ${commands.length} comandos en guild ${guildId}...`);
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    console.log('✅ Comandos registrados.');
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
})();
