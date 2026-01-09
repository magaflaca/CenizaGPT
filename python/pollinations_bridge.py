#!/usr/bin/env python3
import argparse
import json
import os
import random
import time
import urllib.parse
from urllib.parse import urlparse

import requests

# Watermark
from PIL import Image, ImageDraw, ImageFont

DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) CenizaGPTBot/2.1 (+discord)",
    "Accept": "image/*,*/*;q=0.8",
    "Accept-Language": "es-ES,es;q=0.9,en;q=0.7",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
}

# Umbral mínimo razonable: pollinations puede devolver imágenes válidas <50KB
MIN_IMAGE_BYTES = int(os.getenv("POLLINATIONS_MIN_BYTES", "4000"))  # 4KB default


def jprint(obj):
    print(json.dumps(obj, ensure_ascii=False))
    return 0  # siempre 0 para no romper node


def is_http(url: str) -> bool:
    try:
        u = urlparse(url)
        return u.scheme in ("http", "https")
    except Exception:
        return False


def req_get(url, params=None, timeout=140):
    # 1) sin headers
    try:
        r = requests.get(url, params=params, timeout=timeout, allow_redirects=True)
        r.raise_for_status()
        return r
    except Exception:
        pass
    # 2) con headers
    r = requests.get(url, params=params, headers=DEFAULT_HEADERS, timeout=timeout, allow_redirects=True)
    r.raise_for_status()
    return r


def build_pollinations_url(prompt: str) -> str:
    base_url = "https://gen.pollinations.ai/image/"
    return f"{base_url}{urllib.parse.quote(prompt)}"


def pick_key(model_id: str) -> str:
    if model_id == os.getenv("POLLINATIONS_MODEL_ZIMAGE", "zimage"):
        return os.getenv("POLLINATIONS_KEY_ZIMAGE", "")
    if model_id == os.getenv("POLLINATIONS_MODEL_TURBO", "turbo"):
        return os.getenv("POLLINATIONS_KEY_TURBO", "")
    if model_id == os.getenv("POLLINATIONS_MODEL_NANOBANANA", "nanobanana"):
        return os.getenv("POLLINATIONS_KEY_NANOBANANA", "")
    return os.getenv("POLLINATIONS_KEY_FLUX", "")


def _tmp_name(prefix: str = "ceniza_poll", ext: str = "png") -> str:
    ts = int(time.time())
    rnd = random.randint(1000, 9999)
    return os.path.join("/tmp", f"{prefix}_{ts}_{rnd}.{ext}")


def add_watermark_png(png_bytes: bytes, text: str = "CenizaGPT") -> bytes:
    """
    Añade watermark abajo-derecha:
    - opacidad suave
    - sombra para legibilidad
    - tamaño proporcional al ancho
    """
    from io import BytesIO

    img = Image.open(BytesIO(png_bytes)).convert("RGBA")
    w, h = img.size

    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    font_size = max(18, int(w * 0.045))
    margin = max(12, int(w * 0.02))

    font = None
    font_candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for fp in font_candidates:
        if os.path.exists(fp):
            try:
                font = ImageFont.truetype(fp, font_size)
                break
            except Exception:
                pass
    if font is None:
        font = ImageFont.load_default()

    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]

    x = w - tw - margin
    y = h - th - margin

    shadow_offset = max(2, int(font_size * 0.08))
    shadow_color = (0, 0, 0, 160)
    text_color = (255, 255, 255, 210)

    draw.text((x + shadow_offset, y + shadow_offset), text, font=font, fill=shadow_color)
    draw.text((x + shadow_offset // 2, y + shadow_offset // 2), text, font=font, fill=(0, 0, 0, 120))
    draw.text((x, y), text, font=font, fill=text_color)

    out = Image.alpha_composite(img, overlay).convert("RGBA")

    buf = BytesIO()
    out.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["generate", "edit"])
    ap.add_argument("--prompt", required=True)
    ap.add_argument("--model", default=os.getenv("POLLINATIONS_MODEL_FLUX", "flux"))
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--width", type=int, default=1024)
    ap.add_argument("--height", type=int, default=1024)
    ap.add_argument("--quality", default="medium")
    ap.add_argument("--safe", default="false")
    ap.add_argument("--enhance", default="true")
    ap.add_argument("--nologo", default="true")
    ap.add_argument("--image", default="")  # base image url for edit
    ap.add_argument("--watermark", default="CenizaGPT")
    args = ap.parse_args()

    prompt = (args.prompt or "").strip()
    model_id = (args.model or "").strip() or os.getenv("POLLINATIONS_MODEL_FLUX", "flux")
    seed = args.seed if args.seed and args.seed > 0 else random.randint(1, 9999999)

    if not prompt:
        return jprint({"ok": False, "error": "Prompt vacío."})

    key = pick_key(model_id)
    if not key:
        return jprint({"ok": False, "error": f"Falta API key para model={model_id} (revisa .env)"})


    if args.mode == "edit":
        if not args.image or not is_http(args.image):
            return jprint({"ok": False, "error": "Para editar necesitas --image con URL válida."})

    url = build_pollinations_url(prompt)

    # clamp sizes
    width = max(256, min(2048, int(args.width or 1024)))
    height = max(256, min(2048, int(args.height or 1024)))

    params = {
        "model": model_id,
        "width": str(width),
        "height": str(height),
        "seed": str(seed),
        "nologo": str(args.nologo).lower(),
        "enhance": str(args.enhance).lower(),
        "quality": str(args.quality),
        "safe": str(args.safe).lower(),
        "key": key,
    }
    if args.mode == "edit":
        params["image"] = args.image

    try:
        resp = req_get(url, params=params, timeout=140)
        ctype = (resp.headers.get("content-type") or "").lower()

        if "image" not in ctype:
            txt = resp.text[:400] if resp.text else ""
            return jprint({"ok": False, "error": f"Respuesta no-imagen (ctype={ctype}): {txt}"})

        data = resp.content or b""
        if len(data) < MIN_IMAGE_BYTES:
            return jprint({
                "ok": False,
                "error": f"Imagen demasiado pequeña ({len(data)} bytes). Posible error/saldo/bloqueo.",
                "min_bytes": MIN_IMAGE_BYTES,
                "ctype": ctype,
            })

        # ✅ Watermark siempre (si falla, seguimos con original)
        try:
            data = add_watermark_png(data, text=args.watermark or "CenizaGPT")
        except Exception:
            pass

        out_path = _tmp_name(prefix="ceniza_poll", ext="png")
        with open(out_path, "wb") as f:
            f.write(data)

        # buffer_base64 para que node no dependa del filesystem
        import base64
        b64 = base64.b64encode(data).decode("ascii")

        return jprint({
            "ok": True,
            "file": out_path,
            "buffer_base64": b64,
            "seed": seed,
            "model": model_id,
            "width": width,
            "height": height,
            "mode": args.mode,
        })

    except Exception as e:
        return jprint({"ok": False, "error": str(e)})


if __name__ == "__main__":
    raise SystemExit(main())
