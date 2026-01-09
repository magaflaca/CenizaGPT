#!/usr/bin/env python3
import os
import sys
import re
import json
import subprocess
from bs4 import BeautifulSoup

try:
    import groq
except Exception:
    groq = None


def eprint(*args):
    # Solo logs internos (consola). Nunca para el usuario.
    print(*args, file=sys.stderr)


def env_api_key():
    return (
        os.getenv("GROQ_API_KEY_TERRARIA")
        or os.getenv("GROQ_TERRARIA_API_KEY")
        or os.getenv("GROQ_API_KEY")
        or ""
    )


def env_model():
    return (
        os.getenv("GROQ_MODEL_TERRARIA")
        or os.getenv("GROQ_TERRARIA_MODEL")
        or "llama-3.3-70b-versatile"
    )


def normalize_ws(s: str) -> str:
    s = s.replace("\r\n", "\n")
    s = re.sub(r"\n{3,}", "\n\n", s)
    s = re.sub(r"[ \t]{2,}", " ", s)
    return s.strip()


def python_dir() -> str:
    return os.path.dirname(os.path.abspath(__file__))


def run_web_py(url: str, timeout_s: int = 30) -> str:
    """
    COPIA el comportamiento de tu terraria.py:
    - ejecuta web.py en el MISMO directorio (python/)
    - busca el .html más reciente en ese directorio
    - lo lee y lo devuelve
    """
    py_bin = os.getenv("PYTHON_BIN") or "python3"
    wd = python_dir()
    web_py = os.path.join(wd, "web.py")

    if not os.path.exists(web_py):
        raise RuntimeError(f"web.py no existe en: {web_py}")

    # Ejecutar web.py igual que tu script
    proc = subprocess.run(
        [py_bin, "web.py", url],
        cwd=wd,
        capture_output=True,
        text=True,
        timeout=timeout_s
    )

    # Tu script busca *.html en '.' (cwd). Hacemos lo mismo.
    html_files = [f for f in os.listdir(wd) if f.lower().endswith(".html")]
    if not html_files:
        eprint("[terraria_bridge] web.py stdout:\n", proc.stdout)
        eprint("[terraria_bridge] web.py stderr:\n", proc.stderr)
        raise RuntimeError("web.py no generó ningún .html en python/")

    latest = max(html_files, key=lambda f: os.path.getctime(os.path.join(wd, f)))
    p = os.path.join(wd, latest)

    with open(p, "r", encoding="utf-8", errors="ignore") as fh:
        html = fh.read()

    return html


def extract_title(soup: BeautifulSoup) -> str:
    # Igual que tu terraria.py: firstHeading / og:title
    h1 = soup.find("h1", {"id": "firstHeading"})
    if h1:
        return h1.get_text(strip=True)
    og = soup.find("meta", property="og:title")
    if og and og.get("content"):
        return og["content"]
    # fallback
    h = soup.find("h1")
    if h:
        return h.get_text(strip=True)
    return "Sin título"


def extract_content_text(soup: BeautifulSoup) -> str:
    # Igual que tu terraria.py: mw-content-text / mw-parser-output
    content_div = soup.find("div", {"id": "mw-content-text"})
    if not content_div:
        content_div = soup.find("div", {"class": "mw-parser-output"})

    if not content_div:
        return ""

    # Tu script elimina script/style/nav/aside/table (lo copio tal cual) :contentReference[oaicite:2]{index=2}
    for tag in content_div(["script", "style", "nav", "aside", "table"]):
        tag.decompose()

    txt = content_div.get_text(separator="\n", strip=True)
    txt = re.sub(r"\n{3,}", "\n\n", txt)
    return normalize_ws(txt)


def make_structured_excerpt(title: str, text: str) -> str:
    # Similar al "resumen" que arma tu terraria.py antes de pedir al modelo
    # Recorta para no pasar tokens absurdos.
    lines = [ln.strip() for ln in text.split("\n") if len(ln.strip()) > 25]
    excerpt = "\n".join(lines[:30])
    excerpt = excerpt[:6000]
    return f"TÍTULO: {title}\n\nDESCRIPCIÓN:\n{excerpt}"


def groq_call(prompt: str, model: str) -> str:
    if groq is None:
        raise RuntimeError("Falta librería groq (pip install groq).")
    key = env_api_key()
    if not key:
        raise RuntimeError("Falta GROQ_API_KEY_TERRARIA (o equivalente).")

    client = groq.Client(api_key=key)
    res = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": "Eres un asistente experto en Terraria. No inventes datos."},
            {"role": "user", "content": prompt},
        ],
        temperature=0.4,
        max_tokens=900,
    )
    return (res.choices[0].message.content or "").strip()


def summarize(url: str, model: str):
    html = run_web_py(url)
    if not html or len(html) < 1000:
        return {"ok": False, "error": f"No se pudo descargar la página o es muy pequeña ({len(html) if html else 0} caracteres)"}

    soup = BeautifulSoup(html, "html.parser")
    title = extract_title(soup)
    text = extract_content_text(soup)

    if not text or len(text) < 200:
        return {"ok": False, "error": "No pude extraer texto útil de la página."}

    info = make_structured_excerpt(title, text)

    prompt = f"""Basándote en esta información, crea un resumen conciso en español(la información será generalmente de Terraria, pero puedes hablar de cualquier tema fuera del contexto):

{info}

Incluye:
1. Qué es
2. Cómo se obtiene
3. Estadísticas principales (si aparecen)
4. Usos o importancia
5. Datos curiosos/tips (si aparecen)

Si reconoces que la informacion no tiene que ver con terraria, entonces haz un resumen a tu manera.
NO inventes datos; si algo no aparece, dilo.
RESUMEN:"""

    ans = groq_call(prompt, model)
    if not ans or len(ans) < 40:
        return {"ok": False, "error": "El modelo devolvió una respuesta vacía o muy corta."}
    return {"ok": True, "answer": ans}


def ask(url: str, question: str, model: str):
    html = run_web_py(url)
    if not html or len(html) < 1000:
        return {"ok": False, "error": f"No se pudo descargar la página o es muy pequeña ({len(html) if html else 0} caracteres)"}

    soup = BeautifulSoup(html, "html.parser")
    title = extract_title(soup)
    text = extract_content_text(soup)

    if not text or len(text) < 200:
        return {"ok": False, "error": "No pude extraer texto útil de la página."}

    info = make_structured_excerpt(title, text)

    prompt = f"""Eres un experto en Terraria pero puedes responder sobre cualquier tema analizando la wiki.

{info}

PREGUNTA: {question}

Responde en español basándote SOLO en la información anterior:
- Si no está, dilo claramente.
RESPUESTA:"""

    ans = groq_call(prompt, model)
    if not ans or len(ans) < 20:
        return {"ok": False, "error": "El modelo devolvió una respuesta vacía o muy corta."}
    return {"ok": True, "answer": ans}


def parse_args(argv):
    # CLI:
    # terraria_bridge.py summarize --url <url> [--model <model>]
    # terraria_bridge.py ask --url <url> --question <q> [--model <model>]
    if len(argv) < 2:
        return None

    cmd = argv[1].strip().lower()
    url = None
    question = None
    model = None

    i = 2
    while i < len(argv):
        a = argv[i]
        if a == "--url" and i + 1 < len(argv):
            url = argv[i + 1]
            i += 2
            continue
        if a == "--question" and i + 1 < len(argv):
            question = argv[i + 1]
            i += 2
            continue
        if a == "--model" and i + 1 < len(argv):
            model = argv[i + 1]
            i += 2
            continue
        i += 1

    return cmd, url, question, model


def main():
    parsed = parse_args(sys.argv)
    if not parsed:
        print(json.dumps({"ok": False, "error": "Uso: summarize/ask con --url y opcional --question"}, ensure_ascii=False))
        return 2

    cmd, url, question, model = parsed
    model = model or env_model()

    try:
        if cmd == "summarize":
            if not url:
                print(json.dumps({"ok": False, "error": "Falta --url"}, ensure_ascii=False))
                return 2
            out = summarize(url, model)
            print(json.dumps(out, ensure_ascii=False))
            return 0 if out.get("ok") else 2

        if cmd == "ask":
            if not url:
                print(json.dumps({"ok": False, "error": "Falta --url"}, ensure_ascii=False))
                return 2
            if not question:
                print(json.dumps({"ok": False, "error": "Falta --question"}, ensure_ascii=False))
                return 2
            out = ask(url, question, model)
            print(json.dumps(out, ensure_ascii=False))
            return 0 if out.get("ok") else 2

        print(json.dumps({"ok": False, "error": f"Comando desconocido: {cmd}"}, ensure_ascii=False))
        return 2

    except Exception as ex:
        eprint("[terraria_bridge] EXCEPTION:", repr(ex))
        print(json.dumps({"ok": False, "error": str(ex)}, ensure_ascii=False))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
