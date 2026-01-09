#!/usr/bin/env python3
import argparse
import base64
import json
import mimetypes
import os
import sys
from typing import Optional
from urllib.parse import urlparse

import requests

try:
    import groq
except Exception:
    groq = None


DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) CenizaGPTBot/2.1 (+discord) PythonRequests",
    "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    "Accept-Language": "es-ES,es;q=0.9,en;q=0.7",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
}


def eprint(*a):
    print(*a, file=sys.stderr)


def env_key() -> str:
    return os.getenv("GROQ_IMAGE_API_KEY") or os.getenv("GROQ_API_KEY") or ""


def env_model() -> str:
    return os.getenv("GROQ_IMAGE_MODEL") or "meta-llama/llama-4-scout-17b-16e-instruct"


def is_http(url: str) -> bool:
    try:
        u = urlparse(url)
        return u.scheme in ("http", "https")
    except Exception:
        return False


def guess_mime_from_url(url: str) -> str:
    mt = mimetypes.guess_type(url)[0]
    return mt or "image/jpeg"


def load_image_bytes(source: str, timeout: int = 15) -> tuple[Optional[bytes], str]:
    """
    - Si es URL: intenta sin headers, si falla reintenta con headers.
    - Si es path local: lee archivo.
    Devuelve (bytes, mime).
    """
    if is_http(source):
        # 1) intento sin headers
        try:
            r = requests.get(source, timeout=timeout)
            r.raise_for_status()
            ctype = r.headers.get("content-type", "") or guess_mime_from_url(source)
            if not ctype.startswith("image/"):
                ctype = guess_mime_from_url(source)
            return r.content, ctype
        except Exception:
            pass

        # 2) reintento con headers
        try:
            r = requests.get(source, headers=DEFAULT_HEADERS, timeout=timeout)
            r.raise_for_status()
            ctype = r.headers.get("content-type", "") or guess_mime_from_url(source)
            if not ctype.startswith("image/"):
                ctype = guess_mime_from_url(source)
            return r.content, ctype
        except Exception as e:
            return None, f"download_failed: {e}"

    # local
    try:
        with open(source, "rb") as f:
            data = f.read()
        ctype = mimetypes.guess_type(source)[0] or "image/jpeg"
        return data, ctype
    except Exception as e:
        return None, f"file_failed: {e}"


def to_data_url(img_bytes: bytes, mime: str) -> str:
    b64 = base64.b64encode(img_bytes).decode("utf-8")
    return f"data:{mime};base64,{b64}"


def groq_chat_with_image(data_url: str, prompt: str, model: str, api_key: str, max_tokens: int = 1000) -> str:
    if groq is None:
        raise RuntimeError("Falta librería groq (pip install groq).")
    client = groq.Client(api_key=api_key)
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": data_url}},
            ],
        }
    ]
    resp = client.chat.completions.create(
        model=model,
        messages=messages,
        temperature=0.3,
        max_tokens=max_tokens,
    )
    return (resp.choices[0].message.content or "").strip()


def prompt_for_mode(mode: str, user_prompt: str) -> str:
    base_rules = (
        "Responde en español. No inventes cosas que no puedas ver.\n"
        "No intentes identificar personas por nombre (no puedes saberlo con certeza).\n"
    )

    if mode == "describe":
        return base_rules + (
            "Acata exactamente lo que pide el usuario.\n"
            "- Si pide describir: describe.\n"
            "- Si pide leer texto: transcribe el texto visible y, si pide, resúmelo.\n"
            "- Si pregunta algo: responde la pregunta basándote SOLO en lo visible.\n"
            "- Si pide 'quién es': explica que no puedes identificar personas por nombre, pero puedes describir rasgos visibles.\n"
            "Si el usuario no pide nada: describe la imagen brevemente (2-5 líneas).\n"
            f"INSTRUCCIÓN DEL USUARIO: {user_prompt}".strip()
        )

    if mode == "ocr":
        return base_rules + (
            "Acata exactamente lo que pide el usuario. Si el usario no pide nada entonces: Extrae TODO el texto visible (incluye números y símbolos). "
            "Si no hay texto, di: 'No se encontró texto visible.'\n\n"
            f"INSTRUCCIÓN DEL USUARIO: {user_prompt}".strip()
        )

    if mode == "analyze":
        return base_rules + (
            "Analiza la imagen y devuelve un JSON válido con:\n"
            "{\n"
            '  "description": "...",\n'
            '  "main_objects": ["..."],\n'
            '  "style": "...",\n'
            '  "mood": "...",\n'
            '  "contains_text": true/false,\n'
            '  "notable_details": ["..."]\n'
            "}\n"
            "Responde SOLO con JSON.\n\n"
            f"INSTRUCCIÓN EXTRA DEL USUARIO: {user_prompt}".strip()
        )

    # ask
    return base_rules + (
        "Responde la pregunta basándote SOLO en lo visible en la imagen.\n\n"
        f"PREGUNTA: {user_prompt}".strip()
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["describe", "ask", "ocr", "analyze"])
    ap.add_argument("--src", required=True, help="URL o path local de imagen")
    ap.add_argument("--prompt", default="", help="Prompt/pregunta del usuario")
    ap.add_argument("--timeout", type=int, default=15)
    args = ap.parse_args()

    key = env_key()
    model = env_model()

    if not key:
        print(json.dumps({"ok": False, "error": "Falta GROQ_IMAGE_API_KEY o GROQ_API_KEY"}, ensure_ascii=False))
        return 2

    img, mime_or_err = load_image_bytes(args.src, timeout=args.timeout)
    if img is None:
        print(json.dumps({"ok": False, "error": f"No pude cargar imagen: {mime_or_err}"}, ensure_ascii=False))
        return 2

    data_url = to_data_url(img, mime_or_err)
    prompt = prompt_for_mode(args.mode, args.prompt or "")

    try:
        out = groq_chat_with_image(data_url, prompt, model=model, api_key=key, max_tokens=1000)
        if not out:
            print(json.dumps({"ok": False, "error": "Respuesta vacía del modelo"}, ensure_ascii=False))
            return 2
        print(json.dumps({"ok": True, "text": out}, ensure_ascii=False))
        return 0
    except Exception as e:
        eprint("[image_bridge] EXCEPTION:", repr(e))
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
