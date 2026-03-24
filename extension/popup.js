// ===== Popup Script =====
const captureBtn = document.getElementById("captureBtn");
const resultsEl = document.getElementById("results");
const emptyHint = document.getElementById("emptyHint");
const statusEl = document.getElementById("status");
const targetLangEl = document.getElementById("targetLang");

let isCapturing = false;
const sourceLangEl = document.getElementById("sourceLang");

// Restore saved language selections
chrome.storage.local.get(["sourceLang", "targetLang"], (data) => {
  if (data.sourceLang) sourceLangEl.value = data.sourceLang;
  if (data.targetLang) targetLangEl.value = data.targetLang;
});

// Save language selections on change
sourceLangEl.addEventListener("change", () => {
  chrome.storage.local.set({ sourceLang: sourceLangEl.value });
});
targetLangEl.addEventListener("change", () => {
  chrome.storage.local.set({ targetLang: targetLangEl.value });
});

// Check current status on popup open
chrome.runtime.sendMessage({ action: "getStatus" }, (resp) => {
  if (chrome.runtime.lastError) return;
  if (resp && resp.capturing) {
    isCapturing = true;
    captureBtn.textContent = "Stop Capture";
    captureBtn.classList.add("recording");
    statusEl.textContent = "Capturing audio...";
    statusEl.className = "status info";
  }
});

// Load saved results
chrome.storage.local.get(["results"], (data) => {
  if (data.results && data.results.length > 0) {
    emptyHint.style.display = "none";
    data.results.forEach((r) => addResultToUI(r));
  }
});

// Start / Stop button
captureBtn.addEventListener("click", async () => {
  if (isCapturing) {
    chrome.runtime.sendMessage({ action: "stopCapture" });
    isCapturing = false;
    captureBtn.textContent = "Start Capture";
    captureBtn.classList.remove("recording");
    statusEl.textContent = "Stopped";
    statusEl.className = "status";
  } else {
    // Get current active tab
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab) {
      statusEl.textContent = "No active tab";
      statusEl.className = "status error";
      return;
    }

    // Check if it's a valid page (not chrome:// etc)
    if (tab.url && (tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://"))) {
      statusEl.textContent = "Cannot capture Chrome internal pages";
      statusEl.className = "status error";
      return;
    }

    // Clear previous results
    resultsEl.innerHTML = "";
    chrome.storage.local.set({ results: [] });

    statusEl.textContent = "Starting capture...";
    statusEl.className = "status info";

    chrome.runtime.sendMessage({
      action: "startCapture",
      tabId: tab.id,
      targetLang: targetLangEl.value,
      sourceLang: document.getElementById("sourceLang").value,
    });

    isCapturing = true;
    captureBtn.textContent = "Stop Capture";
    captureBtn.classList.add("recording");

    setTimeout(() => {
      if (isCapturing) {
        statusEl.textContent = "Capturing audio... (results appear every ~5s)";
      }
    }, 1000);
  }
});

// Clear button
document.getElementById("clearBtn").addEventListener("click", () => {
  resultsEl.innerHTML = "";
  chrome.storage.local.set({ results: [] });
  statusEl.textContent = "Cleared";
  statusEl.className = "status";
});

// Listen for results
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "displayResult") {
    const data = msg.data;
    if (data.error) {
      statusEl.textContent = "Error: " + data.error;
      statusEl.className = "status error";
      return;
    }

    if (data.text && data.text.trim()) {
      emptyHint.style.display = "none";
      addResultToUI(data);
      statusEl.textContent = "Updated: " + new Date().toLocaleTimeString();
      statusEl.className = "status info";
    }
  }
});

function addResultToUI(data) {
  // Remove empty hint if exists
  const hint = document.getElementById("emptyHint");
  if (hint) hint.style.display = "none";

  const item = document.createElement("div");
  item.className = "result-item";

  const original = data.text || data.original || "";
  const translated = data.translated || "";

  item.innerHTML = `
    <div class="result-original">${escapeHtml(original)}</div>
    <div class="result-translated">${escapeHtml(translated)}</div>
  `;
  resultsEl.insertBefore(item, resultsEl.firstChild);

  // Keep max 30
  while (resultsEl.children.length > 30) {
    resultsEl.removeChild(resultsEl.lastChild);
  }
}

function escapeHtml(t) {
  const d = document.createElement("div");
  d.textContent = t;
  return d.innerHTML;
}
