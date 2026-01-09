import os
import sys
import json
import argparse
import subprocess
import shutil
from groq import Groq
import yt_dlp

# =========================
# CONFIG
# =========================
API_KEY = os.environ.get("GROQ_VIDEO_API_KEY")

def get_client():
    if not API_KEY:
        raise ValueError("Falta GROQ_VIDEO_API_KEY en variables de entorno.")
    return Groq(api_key=API_KEY)

class QuietLogger:
    def debug(self, msg): pass
    def warning(self, msg): pass
    def error(self, msg): pass

# =========================
# UTILIDADES
# =========================

def require_ffmpeg():
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        raise RuntimeError("ffmpeg/ffprobe no encontrados en el sistema.")

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
    output_template = f"{output_base}.%(ext)s"
    final_output = f"{output_base}.mp3"

    if os.path.exists(final_output):
        os.remove(final_output)

    ydl_opts = {
        "format": "bestaudio/best[height<=480]",
        "outtmpl": output_template,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "logger": QuietLogger(),
        "postprocessors": [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "mp3",
            "preferredquality": "128",
        }],
        "socket_timeout": 30,
        # Headers para simular navegador real y evitar bloqueos simples
        "http_headers": {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-us,en;q=0.5",
            "Sec-Fetch-Mode": "navigate",
        }
    }
    
    # Configuración de Cookies
    if cookies_path and os.path.exists(cookies_path):
        ydl_opts["cookiefile"] = cookies_path
    
    # Configuración de Proxy (WARP / Tor / SOCKS5)
    if proxy_url:
        ydl_opts["proxy"] = proxy_url
        # Forzar IPv4 suele ser más estable en algunos proxies
        ydl_opts["source_address"] = "0.0.0.0"

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        ydl.download([url])
    
    return final_output

# =========================
# CORE LOGIC
# =========================

def transcribe_audio(client, audio_path):
    compressed = "temp_compressed.mp3"
    compress_for_whisper(audio_path, compressed)
    
    size_mb = os.path.getsize(compressed) / (1024 * 1024)
    if size_mb > 24:
        raise ValueError(f"El audio es muy largo ({size_mb:.1f}MB). Límite actual de 25MB.")
    
    with open(compressed, "rb") as f:
        transcription = client.audio.transcriptions.create(
            file=(compressed, f.read()),
            model="whisper-large-v3",
            response_format="json",
            temperature=0.0
        )
    return transcription.text

def analyze_transcript(client, transcript, prompt, model):
    messages = [
        {
            "role": "system",
            "content": (
                "Eres CenizaGPT. Te pasaré la transcripción de un video o audio. "
                "Tu tarea es responder al prompt del usuario basándote en esa transcripción. "
                "Responde en el mismo idioma que el usuario."
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
    parser.add_argument("--mode", choices=["url", "file"], required=True, help="Modo de operación")
    parser.add_argument("--input", required=True, help="URL o path al archivo")
    parser.add_argument("--prompt", required=True, help="Prompt del usuario")
    parser.add_argument("--model", default="llama-3.3-70b-versatile", help="Modelo LLM a usar")
    parser.add_argument("--cookies", help="Path al archivo de cookies")
    # Nuevo argumento simplificado para proxy fijo
    parser.add_argument("--proxy", help="URL del proxy (ej: socks5://127.0.0.1:40000)")
    
    args = parser.parse_args()
    
    result = {"ok": False, "answer": ""}
    
    try:
        require_ffmpeg()
        client = get_client()
        
        audio_path = None
        
        # 1. Obtener audio
        if args.mode == "url":
            # Intentamos descarga directa con el proxy proporcionado
            try:
                audio_path = download_audio_from_url(
                    args.input, 
                    "temp_dl_audio", 
                    args.cookies, 
                    args.proxy
                )
            except Exception as e:
                # Mejora en el mensaje de error para debugging
                raise RuntimeError(f"Fallo en descarga (Proxy: {args.proxy or 'Ninguno'}): {str(e)}")
                
        else:
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

    print(json.dumps(result))

if __name__ == "__main__":
    main()
