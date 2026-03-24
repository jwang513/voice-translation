const express = require("express");
const path = require("path");
const Anthropic = require("@anthropic-ai/sdk");

const app = express();
app.use(express.json());

// 从环境变量读取 API Key
const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || "",
});

const LANGUAGES = {
  zh: "中文",
  en: "English",
  ja: "日本語",
  ko: "한국어",
  fr: "Français",
  de: "Deutsch",
  es: "Español",
  ru: "Русский",
  pt: "Português",
  it: "Italiano",
  ar: "العربية",
  th: "ไทย",
  vi: "Tiếng Việt",
};

// 首页 - 直接返回内嵌的 HTML
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// 获取语言列表
app.get("/languages", (_req, res) => {
  res.json(LANGUAGES);
});

// 翻译接口
app.post("/translate", async (req, res) => {
  const { text, target_lang } = req.body;

  if (!text || !text.trim()) {
    return res.status(400).json({ error: "没有输入文本" });
  }

  const targetName = LANGUAGES[target_lang] || target_lang;

  try {
    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `请将以下文本翻译成${targetName}。只输出翻译结果，不要添加任何解释或额外内容。\n\n${text.trim()}`,
        },
      ],
    });

    const translated = message.content[0].text;
    res.json({ translated, original: text.trim() });
  } catch (err) {
    console.error("Translation error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "127.0.0.1", () => {
  console.log("==================================================");
  console.log("  语音翻译应用已启动!");
  console.log(`  请打开浏览器访问: http://127.0.0.1:${PORT}`);
  console.log("==================================================");
});
