// src/vision/imageBridge.js
const { execFile } = require('node:child_process');
const path = require('node:path');

function runPython(args, { timeoutMs = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const py = process.env.PYTHON_BIN || 'python3';
    const script = path.join(process.cwd(), 'python', 'image_bridge.py');

    execFile(py, [script, ...args], { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const msg = stderr?.toString() || err.message;
        return reject(new Error(msg));
      }
      let data;
      try {
        data = JSON.parse(String(stdout || '').trim());
      } catch {
        return reject(new Error(`Salida inválida de image_bridge.py: ${String(stdout || '').slice(0, 300)}`));
      }
      if (!data?.ok) return reject(new Error(data?.error || 'image_bridge fallo'));
      resolve(data.text);
    });
  });
}

async function imageDescribe(src, prompt = '') {
  return runPython(['describe', '--src', src, '--prompt', prompt]);
}

async function imageAsk(src, question) {
  return runPython(['ask', '--src', src, '--prompt', question]);
}

async function imageOCR(src, prompt = '') {
  return runPython(['ocr', '--src', src, '--prompt', prompt]);
}

async function imageAnalyze(src, prompt = '') {
  return runPython(['analyze', '--src', src, '--prompt', prompt]);
}

module.exports = {
  imageDescribe,
  imageAsk,
  imageOCR,
  imageAnalyze,
};
