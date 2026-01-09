const path = require('path');
const { execFile } = require('child_process');
const fs = require('fs');

function pickPythonBin() {
    return process.env.PYTHON_BIN || 'python3'; // O 'python' dependiendo del sistema
}

function parseJsonFromStdout(stdout) {
    const text = String(stdout || '').trim();
    if (!text) throw new Error('video_bridge: stdout vacío');

    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    // Intentar parsear la última línea como JSON (por si hay logs previos)
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (!line.startsWith('{') || !line.endsWith('}')) continue;
        try {
            return JSON.parse(line);
        } catch (_) { }
    }
    return JSON.parse(text);
}

/**
 * Ejecuta el script de python para analizar video/audio
 * @param {object} params
 * @param {string} params.input - URL o Path
 * @param {string} params.mode - 'url' o 'file'
 * @param {string} params.prompt - Pregunta del usuario
 * @param {string} [params.model] - Modelo opcional
 */
function analyzeVideo({ input, mode, prompt, model }, { timeoutMs = 300_000 } = {}) {
    const pythonBin = pickPythonBin();
    const script = path.join(process.cwd(), 'python', 'video_bridge.py');

    const args = ['--mode', mode, '--input', input, '--prompt', prompt, '--auto-proxy'];
    if (model) args.push('--model', model);

    const cookiesPath = path.join(process.cwd(), 'cookies.txt');
    if (fs.existsSync(cookiesPath)) {
        args.push('--cookies', cookiesPath);
    }

    return new Promise((resolve, reject) => {
        // Timeout alto (5m) porque bajar video y transcribir tarda
        execFile(
            pythonBin,
            [script, ...args],
            {
                timeout: timeoutMs,
                maxBuffer: 10 * 1024 * 1024,
                env: { ...process.env, PYTHONUNBUFFERED: '1' }
            },
            (err, stdout, stderr) => {
                if (err) {
                    const e = new Error(`video_bridge fallo: ${err.message || 'exec error'} (Args: ${args.join(' ')})`);
                    e.stderr = String(stderr || '');
                    e.stdout = String(stdout || '');
                    return reject(e);
                }

                let parsed;
                try {
                    parsed = parseJsonFromStdout(stdout);
                } catch (e) {
                    const pe = new Error(`video_bridge: salida no-JSON válida`);
                    pe.stdout = String(stdout || '');
                    pe.stderr = String(stderr || '');
                    return reject(pe);
                }

                if (!parsed || parsed.ok !== true) {
                    const msg = (parsed && parsed.error) ? String(parsed.error) : 'video_bridge: ok=false';
                    const re = new Error(msg);
                    re.stdout = String(stdout || '');
                    re.stderr = String(stderr || '');
                    return reject(re);
                }

                resolve(parsed.answer);
            }
        );
    });
}

module.exports = { analyzeVideo };
