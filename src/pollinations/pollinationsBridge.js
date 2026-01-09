const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

function execFilePromise(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { ...opts, maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
      // OJO: aunque python ahora sale 0, dejamos robusto igual
      if (error) {
        reject({ error, stdout: String(stdout || ''), stderr: String(stderr || '') });
        return;
      }
      resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

function parseJsonLenient(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch (_e) {
    const m = s.match(/\{[\s\S]*\}/);
    if (m) {
      try { return JSON.parse(m[0]); } catch (_e2) {}
    }
  }
  return null;
}

function normalizeBridgeOut(out, stderr) {
  if (!out || typeof out !== 'object') {
    return { ok: false, error: 'bridge_no_json', stderr };
  }

  if (!out.ok) {
    return { ok: false, error: out.error || 'bridge_error', detail: out.detail, stderr };
  }

  // prefer base64
  if (out.buffer_base64) {
    try {
      const buf = Buffer.from(String(out.buffer_base64), 'base64');
      if (buf && buf.length > 0) {
        return {
          ok: true,
          buffer: buf,
          seed: out.seed ?? 0,
          model: out.model,
          width: out.width,
          height: out.height,
          file: out.file || null,
        };
      }
    } catch (_e) {
      // continue
    }
  }

  // fallback: file
  if (out.file) {
    try {
      const p = String(out.file);
      const buf = fs.readFileSync(p);
      return {
        ok: true,
        buffer: buf,
        seed: out.seed ?? 0,
        model: out.model,
        width: out.width,
        height: out.height,
        file: p,
      };
    } catch (e) {
      return { ok: false, error: `no pude leer file=${out.file}`, detail: String(e), stderr };
    }
  }

  return { ok: false, error: 'bridge_ok_but_no_buffer', stderr };
}

async function runBridge(mode, params) {
  const script = path.join(process.cwd(), 'python', 'pollinations_bridge.py');

  const args = [
    script,
    mode,
    '--prompt', String(params.prompt || ''),
    '--model', String(params.modelId || 'flux'),
    '--seed', String(params.seed ?? 0),
    '--width', String(params.width ?? 1024),
    '--height', String(params.height ?? 1024),
    '--watermark', 'CenizaGPT',
  ];

  if (mode === 'edit') {
    args.push('--image', String(params.imageUrl || ''));
  }

  let res;
  try {
    res = await execFilePromise('python3', args, { cwd: process.cwd() });
  } catch (e) {
    // esto ya solo sería si python ni corre, o revienta hard
    const msg = `pollinations_bridge exec failed: ${e?.error?.message || 'unknown'}`;
    const err = new Error(msg);
    err._stdout = e.stdout;
    err._stderr = e.stderr;
    throw err;
  }

  const parsed = parseJsonLenient(res.stdout);
  const norm = normalizeBridgeOut(parsed, res.stderr);

  if (!norm.ok) {
    const err = new Error(`pollinations_bridge failed: ${norm.error}`);
    err._detail = norm.detail;
    err._stderr = norm.stderr;
    err._stdout = res.stdout;
    throw err;
  }

  return norm;
}

async function generateImage({ prompt, modelId, width, height, seed }) {
  return runBridge('generate', { prompt, modelId, width, height, seed });
}

async function editImage({ imageUrl, prompt, modelId, seed, width, height }) {
  return runBridge('edit', { imageUrl, prompt, modelId, seed, width, height });
}

module.exports = {
  generateImage,
  editImage,
};
