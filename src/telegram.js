const { loadConfig } = require("./config_loader");

function apiUrl(method) {
  const { telegramBotToken } = loadConfig();
  return `https://api.telegram.org/bot${telegramBotToken}/${method}`;
}

async function sendMessage(chatId, text, opts = {}) {
  const res = await fetch(apiUrl("sendMessage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: opts.disablePreview !== false,
    }),
  });
  return res.json();
}

async function sendPhoto(chatId, photoUrl, caption) {
  const trimmedCaption = caption && caption.length > 1024 ? caption.slice(0, 1000) + "…" : caption;
  const res = await fetch(apiUrl("sendPhoto"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      photo: photoUrl,
      caption: trimmedCaption,
      parse_mode: "HTML",
    }),
  });
  const json = await res.json();
  if (!json.ok && caption && caption.length > 1024) {
    // fallback: foto senza didascalia + messaggio separato con il testo completo
    await fetch(apiUrl("sendPhoto"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, photo: photoUrl }),
    });
    await sendMessage(chatId, caption);
  }
  return json;
}

async function getUpdates(offset) {
  const res = await fetch(apiUrl("getUpdates"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ offset, timeout: 0, allowed_updates: ["message"] }),
  });
  const json = await res.json();
  return json.ok ? json.result : [];
}

module.exports = { sendMessage, sendPhoto, getUpdates };
