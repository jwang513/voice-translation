// ===== Offscreen Document =====
// Strategy: capture tab audio → play to speakers → use MediaRecorder for backend SR
// Also accumulate text across chunks for better context

const BACKEND_URL = "http://127.0.0.1:5000";
const CHUNK_INTERVAL = 4000; // 4 seconds - shorter for faster response

let mediaStream = null;
let audioContext = null;
let targetLang = "zh";
let sourceLang = "ja";
let isRecording = false;

// Text accumulation buffer
let accumulatedText = [];
let translationQueue = [];
let isTranslating = false;

// Signal ready
console.log("[OFFSCREEN] loaded, signaling ready");
chrome.runtime.sendMessage({ action: "offscreen_ready" });

chrome.runtime.onMessage.addListener((msg) => {
  console.log("[OFFSCREEN] received:", msg.action);
  if (msg.action === "offscreen_start") {
    startCapture(msg.streamId, msg.targetLang, msg.sourceLang);
  } else if (msg.action === "offscreen_stop") {
    stopCapture();
  }
});

async function startCapture(streamId, lang, srcLang) {
  targetLang = lang || "zh";
  sourceLang = srcLang || "ja";
  accumulatedText = [];

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId,
        },
      },
    });
    console.log("[OFFSCREEN] got stream");

    // Play audio so user can still hear
    audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(mediaStream);
    source.connect(audioContext.destination);

    isRecording = true;
    runRecordingCycle();

  } catch (err) {
    console.error("[OFFSCREEN] capture error:", err);
    chrome.runtime.sendMessage({
      action: "captureError",
      error: "Audio capture failed: " + err.message,
    });
  }
}

function runRecordingCycle() {
  if (!isRecording || !mediaStream) return;

  const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : "audio/webm";

  const chunks = [];
  const recorder = new MediaRecorder(mediaStream, { mimeType });

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  recorder.onstop = () => {
    // Immediately start next cycle
    if (isRecording) {
      setTimeout(() => runRecordingCycle(), 50);
    }

    // Process audio in background
    if (chunks.length > 0) {
      const blob = new Blob(chunks, { type: mimeType });
      if (blob.size > 500) {
        transcribeAndTranslate(blob);
      }
    }
  };

  recorder.onerror = () => {
    if (isRecording) setTimeout(() => runRecordingCycle(), 300);
  };

  recorder.start();
  setTimeout(() => {
    if (recorder.state === "recording") recorder.stop();
  }, CHUNK_INTERVAL);
}

async function transcribeAndTranslate(audioBlob) {
  try {
    // Step 1: Send audio for transcription only
    const formData = new FormData();
    formData.append("audio", audioBlob, "audio.webm");
    formData.append("source_lang", sourceLang);

    const srResp = await fetch(`${BACKEND_URL}/transcribe-only`, {
      method: "POST",
      body: formData,
    });
    const srData = await srResp.json();

    if (!srData.text || !srData.text.trim()) return;

    const newText = srData.text.trim();
    console.log("[OFFSCREEN] recognized:", newText);

    // Step 2: Translate only the new text
    const translateResp = await fetch(`${BACKEND_URL}/translate-text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: newText,
        new_text: newText,
        target_lang: targetLang,
        source_lang: sourceLang,
      }),
    });
    const translateData = await translateResp.json();

    if (translateData.translated) {
      chrome.runtime.sendMessage({
        action: "result",
        data: {
          text: newText,
          translated: translateData.translated,
        },
      });
    }
  } catch (err) {
    console.error("[OFFSCREEN] error:", err);
  }
}

function stopCapture() {
  console.log("[OFFSCREEN] stopping");
  isRecording = false;
  accumulatedText = [];

  if (audioContext) {
    try { audioContext.close(); } catch (e) {}
    audioContext = null;
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
  }
}
