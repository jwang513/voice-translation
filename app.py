"""语音翻译应用 - Flask 后端
支持: 1) 网页版语音翻译  2) Chrome插件标签页音频翻译
"""

import os
import sys
import tempfile
import subprocess
import speech_recognition as sr
from flask import Flask, request, jsonify, send_file
from anthropic import Anthropic
from deep_translator import GoogleTranslator
from faster_whisper import WhisperModel

# Fix Windows console encoding for CJK characters
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# ===== 配置 =====
_dir = os.path.dirname(os.path.abspath(__file__))

# ffmpeg 路径
try:
    import imageio_ffmpeg
    FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
except ImportError:
    FFMPEG = "ffmpeg"

# API Key
_api_key = ""
for env_name in [".env", ".env.example"]:
    _env_file = os.path.join(_dir, env_name)
    if os.path.exists(_env_file):
        with open(_env_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("ANTHROPIC_API_KEY=") and not line.startswith("#"):
                    _api_key = line.split("=", 1)[1].strip()
                    break
        if _api_key:
            break
if not _api_key:
    _api_key = os.environ.get("ANTHROPIC_API_KEY", "")

# ===== Flask App =====
app = Flask(__name__)
client = Anthropic(api_key=_api_key)
recognizer = sr.Recognizer()

# Whisper model (local, high quality)
print("  Loading Whisper model...")
whisper_model = WhisperModel("base", device="cpu", compute_type="int8")
print("  Whisper model: OK")

LANGUAGES = {
    "zh": "中文", "en": "English", "ja": "日本語", "ko": "한국어",
    "fr": "Français", "de": "Deutsch", "es": "Español", "ru": "Русский",
    "pt": "Português", "it": "Italiano", "ar": "العربية", "th": "ไทย",
    "vi": "Tiếng Việt",
}

# 语言代码映射 (用于 Google Speech Recognition)
LANG_CODE_MAP = {
    "zh": "zh-CN", "en": "en-US", "ja": "ja-JP", "ko": "ko-KR",
    "fr": "fr-FR", "de": "de-DE", "es": "es-ES", "ru": "ru-RU",
    "pt": "pt-BR", "it": "it-IT", "ar": "ar-SA", "th": "th-TH",
    "vi": "vi-VN",
}


# ===== CORS 支持 (Chrome 插件需要) =====
@app.after_request
def add_cors(response):
    origin = request.headers.get("Origin", "")
    # 允许 Chrome 插件和本地访问
    if origin.startswith("chrome-extension://") or origin == "" or "127.0.0.1" in origin:
        response.headers["Access-Control-Allow-Origin"] = origin or "*"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response


@app.route("/")
def index():
    return send_file("index.html")


# ===== 文本翻译 (网页版) =====
@app.route("/translate", methods=["POST"])
def translate():
    data = request.get_json()
    text = data.get("text", "").strip()
    target_lang = data.get("target_lang", "en")

    if not text:
        return jsonify({"error": "No text"}), 400

    return jsonify(_translate_text(text, target_lang))


# ===== 纯转写 (只做语音识别，不翻译) =====
@app.route("/transcribe-only", methods=["POST", "OPTIONS"])
def transcribe_only():
    if request.method == "OPTIONS":
        return "", 204

    audio_file = request.files.get("audio")
    source_lang = request.form.get("source_lang", "")

    if not audio_file:
        return jsonify({"text": ""}), 200

    tmp_webm_path = None
    tmp_wav_path = None

    try:
        tmp_webm = tempfile.NamedTemporaryFile(suffix=".webm", delete=False, dir=tempfile.gettempdir())
        tmp_webm_path = tmp_webm.name
        audio_file.save(tmp_webm_path)
        tmp_webm.close()

        if os.path.getsize(tmp_webm_path) < 500:
            return jsonify({"text": ""})

        # Convert webm -> wav
        tmp_wav_path = tmp_webm_path.replace(".webm", ".wav")
        cmd = [FFMPEG, "-y", "-i", tmp_webm_path, "-ar", "16000", "-ac", "1", "-f", "wav", tmp_wav_path]
        result = subprocess.run(cmd, capture_output=True, timeout=10)
        if result.returncode != 0:
            return jsonify({"text": ""})

        # Whisper transcription (much better than Google free)
        whisper_lang = source_lang if source_lang else None
        segments, info = whisper_model.transcribe(
            tmp_wav_path,
            language=whisper_lang,
            beam_size=3,
            vad_filter=True,  # Filter out silence
        )
        text = " ".join(seg.text.strip() for seg in segments).strip()

        if text:
            print(f"  Whisper: {text[:80]}")

        return jsonify({"text": text})

    except Exception as e:
        print(f"  SR error: {e}")
        return jsonify({"text": ""})
    finally:
        for path in [tmp_webm_path, tmp_wav_path]:
            try:
                if path and os.path.exists(path):
                    os.unlink(path)
            except Exception:
                pass


# ===== 纯翻译 (只翻译文字，带上下文) =====
@app.route("/translate-text", methods=["POST", "OPTIONS"])
def translate_text_api():
    if request.method == "OPTIONS":
        return "", 204

    data = request.get_json()
    text = data.get("text", "").strip()        # full context
    new_text = data.get("new_text", "").strip() # latest segment
    target_lang = data.get("target_lang", "zh")
    source_lang = data.get("source_lang", "")

    if not text:
        return jsonify({"translated": ""})

    # Skip very short fragments
    if len(new_text) < 3:
        return jsonify({"translated": ""})

    result = _fast_translate(text, target_lang, source_lang)
    print(f"  TL: {text[:30]} -> {result.get('translated', '?')[:30]}")
    return jsonify({"translated": result.get("translated", "")})


# ===== 音频转写+翻译 (Chrome 插件旧接口，保留兼容) =====
@app.route("/transcribe", methods=["POST", "OPTIONS"])
def transcribe():
    if request.method == "OPTIONS":
        return "", 204

    print(f"\n=== /transcribe request ===")
    print(f"  files: {list(request.files.keys())}")
    print(f"  form: {dict(request.form)}")

    audio_file = request.files.get("audio")
    target_lang = request.form.get("target_lang", "en")
    source_lang = request.form.get("source_lang", "")

    if not audio_file:
        return jsonify({"error": "No audio file"}), 400

    tmp_webm = None
    tmp_wav = None

    tmp_webm_path = None
    tmp_wav_path = None

    try:
        # 1. Save uploaded webm to temp file
        tmp_webm = tempfile.NamedTemporaryFile(suffix=".webm", delete=False, dir=tempfile.gettempdir())
        tmp_webm_path = tmp_webm.name
        audio_file.save(tmp_webm_path)
        tmp_webm.close()

        file_size = os.path.getsize(tmp_webm_path)
        print(f"  Audio received: {file_size} bytes")

        if file_size < 500:
            return jsonify({"text": "", "translated": ""})

        # 2. Convert webm -> wav using ffmpeg directly
        tmp_wav_path = tmp_webm_path.replace(".webm", ".wav")
        cmd = [
            FFMPEG, "-y", "-i", tmp_webm_path,
            "-ar", "16000", "-ac", "1", "-f", "wav",
            tmp_wav_path
        ]
        result = subprocess.run(cmd, capture_output=True, timeout=30)
        if result.returncode != 0:
            err_msg = result.stderr.decode("utf-8", errors="ignore")[-200:]
            print(f"  ffmpeg error: {err_msg}")
            return jsonify({"error": "Audio conversion failed"}), 500

        print(f"  WAV created: {os.path.getsize(tmp_wav_path)} bytes")

        # 3. Speech Recognition (Google free)
        with sr.AudioFile(tmp_wav_path) as source:
            audio_data = recognizer.record(source)

        lang_code = LANG_CODE_MAP.get(source_lang, "en-US")

        text = ""
        try:
            text = recognizer.recognize_google(audio_data, language=lang_code)
        except sr.UnknownValueError:
            # If specified lang fails, try other common languages
            for fallback in ["zh-CN", "en-US", "ja-JP"]:
                if fallback == lang_code:
                    continue
                try:
                    text = recognizer.recognize_google(audio_data, language=fallback)
                    break
                except sr.UnknownValueError:
                    continue
        except sr.RequestError as e:
            print(f"  Google SR error: {e}")
            return jsonify({"error": f"Speech recognition service error: {e}"}), 500

        if not text or not text.strip():
            print("  No speech detected")
            return jsonify({"text": "", "translated": ""})

        text = text.strip()
        print(f"  Recognized: {text[:50]}...")

        # Skip very short fragments (single characters, meaningless)
        if len(text) < 4:
            print(f"  Skipped: too short ({len(text)} chars)")
            return jsonify({"text": "", "translated": ""})

        # 4. Fast translate with Google Translate (free + instant)
        print(f"  Translating: {text[:30]} -> {target_lang}")
        result = _fast_translate(text, target_lang, source_lang)
        result["text"] = text
        print(f"  Translated: {result.get('translated', result.get('error', '?'))[:50]}")
        return jsonify(result)

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500
    finally:
        for path in [tmp_webm_path, tmp_wav_path]:
            try:
                if path and os.path.exists(path):
                    os.unlink(path)
            except Exception:
                pass


# Google Translate 语言代码映射
GOOGLE_LANG_MAP = {
    "zh": "zh-CN", "en": "en", "ja": "ja", "ko": "ko",
    "fr": "fr", "de": "de", "es": "es", "ru": "ru",
    "pt": "pt", "it": "it", "ar": "ar", "th": "th", "vi": "vi",
}


def _fast_translate(text, target_lang, source_lang=""):
    """Google Translate - free, fast (~1s)."""
    src = GOOGLE_LANG_MAP.get(source_lang, "auto")
    tgt = GOOGLE_LANG_MAP.get(target_lang, "zh-CN")
    try:
        translated = GoogleTranslator(source=src, target=tgt).translate(text)
        return {"translated": translated, "original": text}
    except Exception as e:
        print(f"  Google Translate error: {e}")
        # Fallback to Claude
        return _translate_text(text, target_lang, source_lang)


def _translate_text(text, target_lang, source_lang=""):
    """Call Claude to translate text."""
    target_name = LANGUAGES.get(target_lang, target_lang)
    source_name = LANGUAGES.get(source_lang, "")

    if source_name:
        prompt = (
            f"The following text is in {source_name}. "
            f"Translate it into {target_name}. "
            f"Output ONLY the translation, nothing else.\n\n{text}"
        )
    else:
        prompt = (
            f"Translate the following text into {target_name}. "
            f"Output ONLY the translation, nothing else.\n\n{text}"
        )

    try:
        message = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=512,
            system="You are a translator. Output ONLY the translation. Never add comments, explanations, or acknowledgments like 'OK' or 'Sure'. Just the translated text, nothing else.",
            messages=[{"role": "user", "content": prompt}],
        )
        return {"translated": message.content[0].text, "original": text}
    except Exception as e:
        return {"error": str(e), "original": text}


if __name__ == "__main__":
    if _api_key:
        print("  API Key: OK")
    else:
        print("  WARNING: API Key not found!")
    print("  ffmpeg:", FFMPEG)
    print("=" * 50)
    print("  Voice Translator Started!")
    print("  Web UI:  http://127.0.0.1:5000")
    print("  Chrome Extension: load from /extension folder")
    print("=" * 50)
    app.run(debug=False, host="127.0.0.1", port=5000)
