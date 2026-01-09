const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG = {
  ip: 'ceniza.sytes.net',
  port: '8162',
  bosses: [],
  events: [],
  context: [],
  rules: 'Ser respetuosos.',
  discord: {
    channels: {
      eventsSchedule: null,
      staffHelp: null,
    },
    roles: {
      founder: null,
      adminPrimary: null,
      adminSecondary: null,
      modTrainee: null,
      botsMain: null,
      botsInvited: null,
      classMelee: null,
      classRanged: null,
      classMage: null,
      classSummoner: null,
    },
  },
  llm: {
    temperature: 0.5,
    maxTokens: 500,
  },
};

function deepMerge(base, patch) {
  if (Array.isArray(base) || Array.isArray(patch)) return patch ?? base;
  if (typeof base !== 'object' || base === null) return patch ?? base;
  const out = { ...base };
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof out[k] === 'object' && out[k] !== null) {
      out[k] = deepMerge(out[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

class ConfigStore {
  constructor(configFile) {
    this.configFile = configFile;
    this.configPath = path.isAbsolute(configFile)
      ? configFile
      : path.join(process.cwd(), configFile);

    this.data = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    this.load();
  }

  load() {
    try {
      if (!fs.existsSync(this.configPath)) {
        this.save();
        return;
      }
      const raw = fs.readFileSync(this.configPath, 'utf8');
      const parsed = JSON.parse(raw);
      this.data = deepMerge(DEFAULT_CONFIG, parsed);
    } catch (err) {
      console.error('[ConfigStore] Error cargando config:', err);
      // Evitar crashear: mantener defaults
      this.data = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    }
  }

  save() {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (err) {
      console.error('[ConfigStore] Error guardando config:', err);
    }
  }

  reload() {
    this.load();
    return this.data;
  }

  get() {
    return this.data;
  }

  setPath(pathArr, value) {
    let obj = this.data;
    for (let i = 0; i < pathArr.length - 1; i++) {
      const key = pathArr[i];
      if (!obj[key] || typeof obj[key] !== 'object') obj[key] = {};
      obj = obj[key];
    }
    obj[pathArr[pathArr.length - 1]] = value;
    this.save();
  }
}

module.exports = { ConfigStore, DEFAULT_CONFIG };
