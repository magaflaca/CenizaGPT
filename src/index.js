require('dotenv').config();

const { Client, GatewayIntentBits, Partials } = require('discord.js');

const { ConfigStore } = require('./stores/configStore');
const { MemoryStore } = require('./stores/memoryStore');
const { ConfirmStore } = require('./stores/confirmStore');
const { ItemsIndex } = require('./terraria/itemsIndex');
const { createGroqClient } = require('./services/groqClients');
const { loadCommands } = require('./commands/loader');
const { messageCreate } = require('./events/messageCreate');
const { interactionCreate } = require('./events/interactionCreate');

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
if (!DISCORD_TOKEN) {
  console.error('Falta DISCORD_TOKEN en .env');
  process.exit(1);
}

const GROQ_API_KEY = process.env.GROQ_API_KEY;
if (!GROQ_API_KEY) {
  console.error('Falta GROQ_API_KEY en .env');
  process.exit(1);
}

// Router model (opcional pero recomendado): separa el "análisis de intención" del modelo principal.
// Si no se define, usamos GROQ_API_KEY como fallback.
const GROQ_ROUTER_API_KEY = process.env.GROQ_ROUTER_API_KEY || GROQ_API_KEY;

const CONFIG_FILE = process.env.CONFIG_FILE || 'serverConfig.json';
const ITEMS_FILE = process.env.ITEMS_FILE || 'items.json';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

const configStore = new ConfigStore(CONFIG_FILE);
const memoryStore = new MemoryStore({ historyLimit: Number(process.env.CHAT_HISTORY_LIMIT) || 12 });
const confirmStore = new ConfirmStore({ ttlMs: 2 * 60 * 1000 });
const itemsIndex = new ItemsIndex(ITEMS_FILE);

const groqNormal = createGroqClient(GROQ_API_KEY);
const groqRouter = createGroqClient(GROQ_ROUTER_API_KEY);

const commands = loadCommands();

const ctx = {
  client,
  configStore,
  memoryStore,
  confirmStore,
  itemsIndex,
  groqNormal,
  groqRouter,
  models: {
    normal: process.env.GROQ_MODEL || 'llama-3.1-8b-instant',
    router: process.env.GROQ_ROUTER_MODEL || 'llama-3.1-8b-instant',
    smart: process.env.GROQ_TERRARIA_MODEL || 'llama-3.3-70b-versatile',
  },
  commands,
};

client.once('clientReady', async () => {
  console.log(`✅ CenizaGPT conectado como ${client.user.tag}`);
  try {
    await client.user.setPresence({
      activities: [{ name: 'Terraria + Discord', type: 0 }],
      status: 'online',
    });
  } catch (_e) { }
});

client.on('messageCreate', (m) => {
  messageCreate(m, ctx).catch((e) => console.error('[messageCreate] Unhandled:', e));
});

client.on('interactionCreate', (i) => {
  interactionCreate(i, ctx).catch((e) => console.error('[interactionCreate] Unhandled:', e));
});

process.on('unhandledRejection', (reason) => {
  console.error('UnhandledRejection:', reason);
});

client.login(DISCORD_TOKEN);
