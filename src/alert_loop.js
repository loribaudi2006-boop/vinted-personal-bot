const { loadConfig } = require("./config_loader");
const { searchVinted } = require("./vinted_search");
const { sendPhoto, sendMessage } = require("./telegram");
const { checkListing } = require("./fake_detector");
const { enrichAndFormatItem } = require("./format_listing");
const { selectMatchingItems } = require("./gemini");
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
  let candidates = items.filter((it) => !seen.has(String(it.id)));
  if (!candidates.length) return;

  // Segniamo come "visti" TUTTI i candidati nuovi grezzi (prima di ogni filtro): così un
  // annuncio scartato dal filtro di pertinenza non viene rivalutato a ogni giro.
  const newlySeenIds = candidates.map((it) => it.id);

  // Filtro di pertinenza severo, se l'avviso ha una descrizione precisa (avvisi creati
  // dopo questo aggiornamento). Evita che "avvisami per una ps4" mandi giochi o accessori.
  if (alert.productDescription && candidates.length) {
    try {
      const keep = await selectMatchingItems(
        { productDescription: alert.productDescription, excludeTypes: alert.excludeTypes || [], userMessage: alert.label },
        candidates
      );
      candidates = candidates.filter((_, i) => keep.has(i + 1));
    } catch {
      // Gemini non disponibile: si prosegue senza il filtro extra
    }
  }

  let withinBudget = alert.maxPrice
    ? candidates.filter((it) => it.price != null && it.price <= alert.maxPrice)
    : candidates;
  if (alert.minPrice) {
    withinBudget = withinBudget.filter((it) => it.price == null || it.price >= alert.minPrice);
  }

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
