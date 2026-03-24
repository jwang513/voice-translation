// ===== Background Service Worker =====
let capturing = false;
let offscreenReady = false;
let pendingStart = null;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log("[BG] received:", msg.action);

  if (msg.action === "startCapture") {
    startCapture(msg.tabId, msg.targetLang, msg.sourceLang);
    sendResponse({ ok: true });
  } else if (msg.action === "stopCapture") {
    stopCapture();
    sendResponse({ ok: true });
  } else if (msg.action === "getStatus") {
    sendResponse({ capturing });
  } else if (msg.action === "offscreen_ready") {
    // Offscreen document is loaded and ready
    console.log("[BG] offscreen ready!");
    offscreenReady = true;
    if (pendingStart) {
      console.log("[BG] sending pending start command");
      chrome.runtime.sendMessage(pendingStart);
      pendingStart = null;
    }
  } else if (msg.action === "result") {
    // Forward results to popup
    chrome.runtime.sendMessage({
      action: "displayResult",
      data: msg.data,
    });
    // Also store in storage so popup can retrieve later
    chrome.storage.local.get(["results"], (stored) => {
      const arr = stored.results || [];
      arr.push(msg.data);
      if (arr.length > 50) arr.shift();
      chrome.storage.local.set({ results: arr });
    });
  } else if (msg.action === "captureError") {
    console.error("[BG] capture error:", msg.error);
    capturing = false;
    chrome.runtime.sendMessage({
      action: "displayResult",
      data: { error: msg.error },
    });
  }
  return true;
});

async function startCapture(tabId, targetLang, sourceLang) {
  if (capturing) {
    await stopCapture();
  }

  try {
    console.log("[BG] getting stream ID for tab:", tabId);

    // 1. Get media stream ID
    const streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: tabId,
    });
    console.log("[BG] got streamId:", streamId.substring(0, 20) + "...");

    // 2. Create offscreen document
    offscreenReady = false;
    try {
      await chrome.offscreen.closeDocument();
    } catch (e) {}

    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["USER_MEDIA"],
      justification: "Capture tab audio for transcription and translation",
    });

    // 3. Prepare start message - will be sent when offscreen signals ready
    const startMsg = {
      action: "offscreen_start",
      streamId: streamId,
      targetLang: targetLang,
      sourceLang: sourceLang,
    };

    if (offscreenReady) {
      chrome.runtime.sendMessage(startMsg);
    } else {
      console.log("[BG] waiting for offscreen to be ready...");
      pendingStart = startMsg;
    }

    capturing = true;
  } catch (err) {
    console.error("[BG] startCapture error:", err);
    chrome.runtime.sendMessage({
      action: "displayResult",
      data: { error: "Capture failed: " + err.message },
    });
  }
}

async function stopCapture() {
  capturing = false;
  offscreenReady = false;
  pendingStart = null;

  try {
    chrome.runtime.sendMessage({ action: "offscreen_stop" });
  } catch (e) {}

  try {
    await chrome.offscreen.closeDocument();
  } catch (e) {}
}
