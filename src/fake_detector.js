const { loadConfig } = require("./config_loader");
const { assessListingAuthenticity } = require("./gemini");

function findReferencePrice(title, referencePrices) {
  const lower = title.toLowerCase();
  let best = null;
  for (const [key, price] of Object.entries(referencePrices)) {
    if (lower.includes(key) && (!best || key.length > best.key.length)) {
      best = { key, price };
    }
  }
  return best ? best.price : null;
}

function heuristicSuspicious(item, referencePrice, cfg) {
  const { maxDiscountRatioBeforeSuspicious, suspiciousPhrases } = cfg.fakeListingHeuristics;
  if (referencePrice && item.price) {
    const ratio = item.price / referencePrice;
    if (ratio < (1 - maxDiscountRatioBeforeSuspicious)) return true;
  }
  const haystack = `${item.title} ${item.description || ""}`.toLowerCase();
  return suspiciousPhrases.some((p) => haystack.includes(p));
}

/**
 * Ritorna { suspicious, reason }. Usa prima l'euristica gratuita; chiama Gemini
 * solo se l'euristica NON ha già trovato qualcosa di sospetto (per risparmiare quota),
 * dando comunque un secondo parere prima di inviare un alert.
 */
async function checkListing(item) {
  const cfg = loadConfig();
  const referencePrice = findReferencePrice(item.title || "", cfg.referencePrices);
  const heuristicFlag = heuristicSuspicious(item, referencePrice, cfg);

  if (heuristicFlag) {
    return { suspicious: true, reason: "Prezzo/testo anomalo rilevato dai controlli automatici" };
  }

  try {
    const result = await assessListingAuthenticity({
      title: item.title,
      price: item.price,
      referencePrice,
      description: item.description,
    });
    return result;
  } catch {
    // Se Gemini non è disponibile, non blocchiamo l'alert: meglio un falso negativo
    // occasionale che perdere un affare vero per un errore di rete/quota.
    return { suspicious: false, reason: "Controllo IA non disponibile, superato solo euristica" };
  }
}

module.exports = { checkListing, findReferencePrice };
