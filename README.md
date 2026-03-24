# Voice Translation

A real-time voice translation app that supports both a web UI and a Chrome extension for translating tab audio.

## Features

- Real-time speech recognition using Whisper (local, offline)
- Translation powered by Google Translate (fast) with Claude AI as fallback
- Web UI for microphone-based voice translation
- Chrome extension for translating audio from any browser tab
- Supports 13 languages: Chinese, English, Japanese, Korean, French, German, Spanish, Russian, Portuguese, Italian, Arabic, Thai, Vietnamese

## Requirements

- Windows
- Anaconda with a Python environment (tested on `mytest`)
- Anthropic API key (get one at https://www.anthropic.com)

## Setup

**1. Install dependencies**

```bash
pip install -r requirements.txt
```

**2. Set your API key**

Create a `.env` file in the project folder:

```
ANTHROPIC_API_KEY=your_api_key_here
```

**3. Update the Python path in `start_translate.bat`**

Open `start_translate.bat` and change this line to match your Anaconda environment:

```bat
C:\soft\anaconda\envs\mytest\python.exe "%~dp0app.py"
```

Replace `C:\soft\anaconda` with your Anaconda install path and `mytest` with your environment name.

**4. Start the app**

Double-click `start_translate.bat`

The server will start at `http://127.0.0.1:5000`

## Usage

### Web UI

Open `http://127.0.0.1:5000` in your browser, select source and target languages, then click the mic button to start speaking.

### Chrome Extension

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select the `extension` folder
4. Click the extension icon on any tab to start translating audio

## Stop the App

Double-click `close_translate.bat` to stop the server and free port 5000.
