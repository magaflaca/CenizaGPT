import os
import sys
import json
import argparse
import subprocess
import shutil
import math
from groq import Groq
import yt_dlp
import urllib.request
import random
import signal

# =========================
# CONFIG
# =========================
# Se espera que el bot pase la API KEY via entorno, o se lea del .env si se corre manual
API_KEY = os.environ.get("GROQ_VIDEO_API_KEY")

def get_client():
    if not API_KEY:
        raise ValueError("Falta GROQ_VIDEO_API_KEY en variables de entorno.")
    return Groq(api_key=API_KEY)

class QuietLogger:
    def debug(self, msg):
        pass
    def warning(self, msg):
        pass
    def error(self, msg):
        pass

# =========================
# UTILIDADES
# =========================

def require_ffmpeg():
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        raise RuntimeError("ffmpeg/ffprobe no encontrados en el sistema.")

def get_duration_seconds(audio_path):
    cmd = [
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        audio_path
    ]
    # Si falla, lanzará excepción que capturamos arriba
    out = subprocess.check_output(cmd).decode().strip()
    return float(out)

def fetch_free_proxies():
    print("Buscando proxys gratuitos...")
    # Usamos listas raw de GitHub que son mas rapidas y fiables que APIs
    # Fuente: monosans/proxy-list
    urls = [
        "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt",
        "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt"
    ]
    
    proxies = []
    for url in urls:
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=5) as response:
                content = response.read().decode()
                lines = content.splitlines()
                # Tomamos 20 al azar de cada lista para tener más oportunidades
                random.shuffle(lines)
                for line in lines[:20]:
                    if ":" in line:
                        proxies.append(line.strip()) # yt-dlp auto-detecta esquema si no se pone, o agregamos http://
        except Exception as e:
            print(f"Error fetching from {url}: {e}")
            
    return proxies

def compress_for_whisper(input_audio, output_audio):
    # Convertir a mono, 16kHz, 64k (formato ligero para whisper)
    cmd = [
        "ffmpeg", "-y",
        "-i", input_audio,
        "-ac", "1",
        "-ar", "16000",
        "-b:a", "64k",
        output_audio
    ]
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
    return output_audio

def download_audio_from_url(url, output_base="temp_audio", cookies_path=None, proxy_url=None):
    # yt-dlp setup
    # Usamos un nombre fijo temp para simplificar limpieza
    output_template = f"{output_base}.%(ext)s"
    final_output = f"{output_base}.mp3"

    # Si existe previo, borrar
    if os.path.exists(final_output):
        os.remove(final_output)

    ydl_opts = {
        "format": "bestaudio/best[height<=480]", # Audio preferido, sino video bajito (evita 4k)
        "outtmpl": output_template,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "logger": QuietLogger(),
        "postprocessors": [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "mp3",
            "preferredquality": "128", # Calidad suficiente para whisper, más rapido
        }],
        "socket_timeout": 10, # Timeout para evitar colgarse en proxys malos
        "extractor_args": {
            "youtube": {
                "player_client": ["android", "ios"], # Intenta usar clientes moviles que no piden login
            }
        },
        # Eliminamos headers manuales para no conflictuar con el User-Agent de android/ios
    }
    
    if cookies_path and os.path.exists(cookies_path):
        ydl_opts["cookiefile"] = cookies_path
    
    if proxy_url:
        ydl_opts["proxy"] = proxy_url
        print(f"Usando proxy: {proxy_url}...")

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        ydl.download([url])
    
    return final_output

# =========================
# CORE LOGIC
# =========================

def transcribe_audio(client, audio_path):
    # API limits: 25MB. Si es muy largo, habría que cortar.
    # Por ahora implementamos la versión simple de vidscrap que asume que entra o corta?
    # vidscrap usa split_audio_ffmpeg. Implementemos algo similar si es necesario.
    # Para ser robustos, hacemos el compress primero.
    
    compressed = "temp_compressed.mp3"
    compress_for_whisper(audio_path, compressed)
    
    # Check size
    size_mb = os.path.getsize(compressed) / (1024 * 1024)
    if size_mb > 24:
        # TODO: Implementar split si es necesario, por ahora error
        raise ValueError(f"El audio es muy largo ({size_mb:.1f}MB). Límite actual de 25MB.")
    
    with open(compressed, "rb") as f:
        transcription = client.audio.transcriptions.create(
            file=(compressed, f.read()),
            model="whisper-large-v3",
            response_format="json",
            temperature=0.0
        )
    
    return transcription.text

def analyze_transcript(client, transcript, prompt, model=os.environ.get("GROQ_VIDEO_MODEL") or "llama-3.3-70b-versatile"):
    # Usa un modelo grande para razonar sobre el texto
    messages = [
        {
            "role": "system",
            "content": (
                "Eres CenizaGPT. Te pasaré la transcripción de un video o audio. "
                "Tu tarea es responder al prompt del usuario basándote en esa transcripción. "
                "Responde en el mismo idioma que el usuario (generalmente español rioplatense pero formal si se requiere)."
            )
        },
        {
            "role": "user",
            "content": f"TRANSCRIPCIÓN:\n{transcript}\n\nPROMPT DEL USUARIO:\n{prompt}"
        }
    ]
    
    chat = client.chat.completions.create(
        messages=messages,
        model=model,
        temperature=0.5,
        max_tokens=1024
    )
    return chat.choices[0].message.content

# =========================
# ENTRY POINT
# =========================

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["url", "file"], help="Modo de operación")
    parser.add_argument("--input", help="URL o path al archivo")
    parser.add_argument("--prompt", help="Prompt del usuario")
    parser.add_argument("--model", default="llama-3.3-70b-versatile", help="Modelo LLM a usar")
    parser.add_argument("--cookies", help="Path al archivo de cookies (para yt-dlp)")
    parser.add_argument("--auto-proxy", action="store_true", help="Intentar usar proxys gratuitos si falla")
    
    args = parser.parse_args()

    # Validacion manual de args requeridos para modo normal
    if not args.mode or not args.input or not args.prompt:
        # Fallback a error de argparse si faltan
        if not args.mode: parser.error("--mode is required")
        if not args.input: parser.error("--input is required")
        if not args.prompt: parser.error("--prompt is required")
    
    result = {"ok": False, "answer": ""}
    
    try:
        require_ffmpeg()
        client = get_client()
        
        audio_path = None
        
        # 1. Obtener audio
        if args.mode == "url":
            # Lógica de retry con proxy
            proxies_to_try = [None] # Primero directo
            if args.auto_proxy:
                print("Modo auto-proxy activado.")
                fetched = fetch_free_proxies()
                if fetched:
                    print(f"Se encontraron {len(fetched)} proxys.")
                    proxies_to_try.extend(fetched)
                else:
                    print("No se encontraron proxys, se intentará directo.")

            download_success = False
            last_error = None

            for proxy in proxies_to_try:
                try:
                    audio_path = download_audio_from_url(args.input, "temp_dl_audio", args.cookies, proxy)
                    download_success = True
                    break
                except Exception as e:
                    err_str = str(e)
                    # Errores fatales que no se arreglan cambiando proxy
                    if "Video unavailable" in err_str or "Incomplete YouTube ID" in err_str:
                         raise e
                    
                    # Para todo lo demás (bloqueos, timeouts, errores de red), probamos siguiente proxy
                    if proxy: print(f"Falló proxy {proxy}: {err_str[:50]}...")
                    last_error = e
                    continue
            
            if not download_success:
                raise last_error or RuntimeError("Todos los intentos de descarga fallaron.")
        else:
            # Si es archivo local (ya descargado por node), lo usamos
            audio_path = args.input
            if not os.path.exists(audio_path):
                raise FileNotFoundError(f"No se encontró el archivo: {audio_path}")
        
        if not audio_path:
            raise RuntimeError("No se pudo obtener el audio.")

        # 2. Transcribir
        transcript = transcribe_audio(client, audio_path)
        
        # 3. Analizar con LLM
        answer = analyze_transcript(client, transcript, args.prompt, args.model)
        
        result["ok"] = True
        result["answer"] = answer
        result["transcript_preview"] = transcript[:200]
        
        # Cleanup
        if args.mode == "url" and os.path.exists(audio_path):
             try: os.remove(audio_path)
             except: pass
        if os.path.exists("temp_compressed.mp3"):
             try: os.remove("temp_compressed.mp3")
             except: pass

    except Exception as e:
        result["error"] = str(e)
        # debug
        # print(f"DEBUG ERROR: {e}", file=sys.stderr) 

    print(json.dumps(result))

if __name__ == "__main__":
    main()
