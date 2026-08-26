const fs = require("fs");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const rawConfig = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "config.json"), "utf8")
);

function loadConfig() {
  const geminiApiKeys = [
    process.env.GEMINI_API_KEY_1,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
    process.env.GEMINI_API_KEY, // compatibilità: singola chiave
  ].filter(Boolean);

  return {
    ...rawConfig,
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "",
    geminiApiKeys,
    chromePath: process.env.CHROME_PATH || rawConfig.chromePath,
  };
}

module.exports = { loadConfig };
