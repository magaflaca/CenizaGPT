const fs = require('fs');
const path = require('path');

function loadCommands() {
  const commandsPath = path.join(__dirname);
  const files = fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js') && f !== 'loader.js');
  const map = new Map();
  for (const file of files) {
    const cmd = require(path.join(commandsPath, file));
    if (!cmd || !cmd.data || !cmd.execute) continue;
    map.set(cmd.data.name, cmd);
  }
  return map;
}

module.exports = { loadCommands };
