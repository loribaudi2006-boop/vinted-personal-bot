const path = require("path");
const fs = require("fs");
const { atomicWriteJson, readJsonSafe } = require("./lock");

const USERS_DIR = path.join(__dirname, "..", "data", "users");

function userFile(chatId) {
  return path.join(USERS_DIR, `${chatId}.json`);
}

function defaultUser(chatId) {
  return {
    chatId,
    createdAt: new Date().toISOString(),
    alerts: [], // { id, label, query, productDescription, excludeTypes, maxPrice, minPrice, createdAt }
    seen: {}, // alertId -> [vintedItemId,...] (troncato)
  };
}

function getUser(chatId) {
  const data = readJsonSafe(userFile(chatId), null);
  return data || defaultUser(chatId);
}

function saveUser(user) {
  atomicWriteJson(userFile(user.chatId), user);
}

function listAllUsers() {
  if (!fs.existsSync(USERS_DIR)) return [];
  return fs
    .readdirSync(USERS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => readJsonSafe(path.join(USERS_DIR, f), null))
    .filter(Boolean);
}

function addAlert(chatId, alert) {
  const user = getUser(chatId);
  const id = Date.now().toString(36);
  const entry = { id, createdAt: new Date().toISOString(), ...alert };
  user.alerts.push(entry);
  user.seen[id] = [];
  saveUser(user);
  return entry;
}

function removeAlert(chatId, alertId) {
  const user = getUser(chatId);
  const before = user.alerts.length;
  user.alerts = user.alerts.filter((a) => a.id !== alertId);
  delete user.seen[alertId];
  saveUser(user);
  return user.alerts.length < before;
}

function markSeen(chatId, alertId, itemIds) {
  const user = getUser(chatId);
  const prev = user.seen[alertId] || [];
  const merged = Array.from(new Set([...prev, ...itemIds])).slice(-500);
  user.seen[alertId] = merged;
  saveUser(user);
}

module.exports = {
  getUser,
  saveUser,
  listAllUsers,
  addAlert,
  removeAlert,
  markSeen,
};
