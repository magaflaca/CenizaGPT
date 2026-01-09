const path = require('path');
const { execFile } = require('child_process');

function pickPythonBin() {
  return process.env.PYTHON_BIN || 'python3';
}

function parseJsonFromStdout(stdout) {
  const text = String(stdout || '').trim();
  if (!text) throw new Error('terraria_bridge: stdout vacío');

  // A veces hay prints; intentamos el último objeto JSON válido en líneas
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.startsWith('{') || !line.endsWith('}')) continue;
    try {
      return JSON.parse(line);
    } catch (_) {}
  }

  // fallback: intentar parsear todo
  return JSON.parse(text);
}

function runBridge(args, { timeoutMs = 45_000 } = {}) {
  const pythonBin = pickPythonBin();
  const script = path.join(process.cwd(), 'python', 'terraria_bridge.py');

  return new Promise((resolve, reject) => {
    execFile(
      pythonBin,
      [script, ...args],
      { timeout: timeoutMs, maxBuffer: 5 * 1024 * 1024 }, // por si devuelve bastante texto
      (err, stdout, stderr) => {
        if (err) {
          // NO filtrar stderr al usuario (solo para logs)
          const e = new Error(`terraria_bridge fallo: ${err.message || 'exec error'}`);
          e.stderr = String(stderr || '');
          e.stdout = String(stdout || '');
          return reject(e);
        }

        let parsed;
        try {
          parsed = parseJsonFromStdout(stdout);
        } catch (e) {
          const pe = new Error(`terraria_bridge: salida no-JSON válida`);
          pe.stdout = String(stdout || '');
          pe.stderr = String(stderr || '');
          return reject(pe);
        }

        if (!parsed || parsed.ok !== true) {
          const msg = (parsed && parsed.error) ? String(parsed.error) : 'terraria_bridge: ok=false';
          const re = new Error(msg);
          re.stdout = String(stdout || '');
          re.stderr = String(stderr || '');
          return reject(re);
        }

        return resolve(String(parsed.answer || '').trim());
      }
    );
  });
}

async function terrariaSummarize(url, { model } = {}) {
  const args = ['summarize', '--url', url];
  if (model) args.push('--model', model);
  return runBridge(args);
}

async function terrariaAsk(url, question, { model } = {}) {
  const args = ['ask', '--url', url, '--question', question];
  if (model) args.push('--model', model);
  return runBridge(args);
}

module.exports = {
  terrariaSummarize,
  terrariaAsk,
};
