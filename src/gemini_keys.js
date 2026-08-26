const path = require("path");
const { loadConfig } = require("./config_loader");
const { atomicWriteJson, readJsonSafe, acquireLock, releaseLock } = require("./lock");

const STATE_FILE = path.join(__dirname, "..", "data", "gemini_key_state.json");

function nextApiKey() {
  const { geminiApiKeys } = loadConfig();
  if (!geminiApiKeys.length) throw new Error("Nessuna GEMINI_API_KEY configurata");
  if (geminiApiKeys.length === 1) return geminiApiKeys[0];

  acquireLock();
  try {
    const state = readJsonSafe(STATE_FILE, { index: 0 });
    const key = geminiApiKeys[state.index % geminiApiKeys.length];
    state.index = (state.index + 1) % geminiApiKeys.length;
    atomicWriteJsonNoLock(STATE_FILE, state);
    return key;
  } finally {
    releaseLock();
  }
}

// atomicWriteJson acquisisce già il lock: qui siamo già dentro la sezione critica,
// quindi scriviamo direttamente senza ri-acquisirlo (eviterebbe un deadlock).
const fs = require("fs");
function atomicWriteJsonNoLock(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = filePath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

module.exports = { nextApiKey };
