import argparse
import os
import re
import sys
import time
import hashlib
from urllib.parse import urlparse

import requests

# Headers para camuflarse como navegador real (Backup para Wikipedia)
BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
}

def safe_domain(url: str) -> str:
    host = urlparse(url).netloc or "unknown"
    host = host.replace(".", "_")
    host = re.sub(r"[^a-zA-Z0-9_]+", "_", host)
    return host[:80] or "unknown"


def unique_name(url: str) -> str:
    dom = safe_domain(url)
    h = hashlib.sha1(url.encode("utf-8")).hexdigest()[:10]
    ts = int(time.time())
    return f"{dom}_{ts}_{h}.html"


def descargar_html(url: str, out_path: str | None = None, timeout: int = 20) -> str:
    print(f"Conectando a: {url}")
    html = ""
    
    # --- ESTRATEGIA HÍBRIDA ---
    try:
        # INTENTO 1: Modo "Crudo" (Sin headers)
        # Ideal para Fandom, que suele bloquear scripts que fingen ser Chrome pero no lo son.
        r = requests.get(url, headers=None, timeout=timeout, allow_redirects=True)
        r.raise_for_status()
        html = r.text
        
    except requests.exceptions.HTTPError as e:
        # Si recibimos un 403 Forbidden (común en Wikipedia), activamos el plan B
        if e.response.status_code in [403, 401, 429]:
            print(f"⚠️  Sitio rechazó conexión estándar ({e}). Activando camuflaje...")
            try:
                # INTENTO 2: Modo "Navegador" (Con headers falsos)
                # Ideal para Wikipedia y sitios que exigen User-Agent.
                r = requests.get(url, headers=BROWSER_HEADERS, timeout=timeout, allow_redirects=True)
                r.raise_for_status()
                html = r.text
            except Exception as e2:
                print(f"✗ Error fatal en reintento: {e2}")
                return ""
        else:
            print(f"✗ Error HTTP: {e}")
            return ""
            
    except Exception as e:
        print(f"✗ Error de conexión: {e}")
        return ""

    # Validación final de contenido
    if not html:
        return ""

    if len(html) < 4000:
        print(f"⚠️  ADVERTENCIA: Archivo sospechosamente pequeño ({len(html)} chars).")

    if not out_path:
        out_path = unique_name(url)

    # Asegura directorio
    out_dir = os.path.dirname(out_path)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)

    with open(out_path, "w", encoding="utf-8") as f:
        f.write(html)

    print(f"✓ HTML guardado en: {out_path}")
    print(f"✓ Tamaño: {len(html)} caracteres")
    return out_path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("url", nargs="?", help="URL a descargar")
    parser.add_argument("--url", dest="url_flag", help="URL a descargar (alternativo)")
    parser.add_argument("--out", dest="out", help="Ruta de salida del HTML (opcional)")
    parser.add_argument("--timeout", dest="timeout", type=int, default=20, help="Timeout en segundos")
    args = parser.parse_args()

    url = args.url_flag or args.url
    if not url:
        print("Uso: python web.py <URL>  |  python web.py --url <URL> [--out <PATH>]")
        sys.exit(2)

    out = descargar_html(url, out_path=args.out, timeout=args.timeout)
    if not out:
        sys.exit(1)

    sys.exit(0)


if __name__ == "__main__":
    main()
