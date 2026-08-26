const fs = require("fs");
const path = require("path");

const LOCK_PATH = path.join(__dirname, "..", "data", ".lock");
const STALE_MS = 20000;

function acquireLock() {
  const start = Date.now();
  while (fs.existsSync(LOCK_PATH)) {
    const age = Date.now() - fs.statSync(LOCK_PATH).mtimeMs;
    if (age > STALE_MS) {
      fs.rmSync(LOCK_PATH, { force: true });
      break;
    }
    if (Date.now() - start > 10000) {
      fs.rmSync(LOCK_PATH, { force: true });
      break;
    }
  }
  fs.writeFileSync(LOCK_PATH, String(process.pid));
}

function releaseLock() {
  fs.rmSync(LOCK_PATH, { force: true });
}

function atomicWriteJson(filePath, data) {
  acquireLock();
  try {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = filePath + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, filePath);
  } finally {
    releaseLock();
  }
}

function readJsonSafe(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

module.exports = { acquireLock, releaseLock, atomicWriteJson, readJsonSafe };
