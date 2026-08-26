const { loadConfig } = require("./config_loader");
const { searchVinted } = require("./vinted_search");
const { sendPhoto, sendMessage } = require("./telegram");
const { checkListing } = require("./fake_detector");
const { enrichAndFormatItem } = require("./format_listing");
const store = require("./store");

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

async function processAlert(user, alert) {
  let items;
  try {
    items = await searchVinted(alert.query);
  } catch (e) {
    console.error(`Ricerca fallita per alert ${alert.id}:`, e.message);
    return;
  }

  const seen = new Set((user.seen[alert.id] || []).map(String));
  const candidates = items.filter((it) => !seen.has(String(it.id)));
  if (!candidates.length) return;

  const withinBudget = alert.maxPrice
    ? candidates.filter((it) => it.price != null && it.price <= alert.maxPrice)
    : candidates;

  const newlySeenIds = candidates.map((it) => it.id);

  for (const item of withinBudget) {
    const verdict = await checkListing(item).catch(() => ({ suspicious: false }));
    if (verdict.suspicious) continue;

    const caption = await enrichAndFormatItem(item, `🔔 <b>${escapeHtml(alert.label)}</b>\n`);

    if (item.photoUrl) {
      await sendPhoto(user.chatId, item.photoUrl, caption);
    } else {
      await sendMessage(user.chatId, caption);
    }
  }

  store.markSeen(user.chatId, alert.id, newlySeenIds);
}

async function runAlertCycle() {
  const users = store.listAllUsers();
  for (const user of users) {
    for (const alert of user.alerts) {
      await processAlert(user, alert).catch((e) =>
        console.error(`Errore alert ${alert.id} utente ${user.chatId}:`, e.message)
      );
    }
  }
}

async function runAlertLoopFor(durationMs) {
  const { searchLoopIntervalSec } = loadConfig();
  const end = Date.now() + durationMs;
  while (Date.now() < end) {
    await runAlertCycle().catch((e) => console.error("runAlertCycle error:", e.message));
    await new Promise((r) => setTimeout(r, searchLoopIntervalSec * 1000));
  }
}

module.exports = { runAlertCycle, runAlertLoopFor };
