const fs = require("fs");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const rawConfig = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "config.json"), "utf8")
);

function loadConfig() {
  // Tutte le GEMINI_API_KEY_N presenti (1,2,3,4,...) in ordine numerico, più la
  // eventuale GEMINI_API_KEY singola per compatibilità. Aggiungere una chiave = basta
  // creare il secret GEMINI_API_KEY_4 (ecc.), nessuna modifica al codice.
  const numbered = Object.keys(process.env)
    .filter((k) => /^GEMINI_API_KEY_\d+$/.test(k))
    .sort((a, b) => Number(a.match(/\d+$/)[0]) - Number(b.match(/\d+$/)[0]))
    .map((k) => process.env[k]);
  const geminiApiKeys = [...numbered, process.env.GEMINI_API_KEY].filter(Boolean);

  return {
    ...rawConfig,
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "",
    geminiApiKeys,
    chromePath: process.env.CHROME_PATH || rawConfig.chromePath,
  };
}

module.exports = { loadConfig };
