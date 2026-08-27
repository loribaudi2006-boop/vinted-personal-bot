const { fetchListingEnrichment } = require("./vinted_search");
const { summarizeListing } = require("./gemini");
const { findParts } = require("./amazon_search");
const { loadConfig } = require("./config_loader");

// Cerchiamo i pezzi di ricambio solo per oggetti che hanno davvero senso riparare:
// se ne' il titolo ne' il difetto dichiarato somigliano a un dispositivo elettronico,
// non apriamo pagine Amazon inutilmente (una "giacca con zip rotta" non c'entra).
const REPAIRABLE_RE = /\b(ps[2345]|playstation|dualsense|dualshock|xbox|series\s*[sx]|nintendo|switch|joy-?con|wii|controller|joystick|console|3ds|psp|steam\s*deck|pc|notebook|monitor|drone|gopro|fotocamera|reflex|obiettivo|iphone|ipad|airpods|kindle|tablet|smartwatch)\b/i;

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

/**
 * Apre l'annuncio, estrae spedizione/stelle venditore e fa riassumere a Gemini
 * eventuali problemi/motivo della vendita dichiarati nel testo. Se qualcosa fallisce
 * (pagina non raggiungibile, Gemini non disponibile), torna comunque un messaggio
 * utilizzabile con le sole informazioni base già note (titolo/prezzo/link).
 */
async function enrichAndFormatItem(item, prefix = "") {
  const basePrice = item.price != null ? `${item.price}€` : item.priceText || "prezzo n.d.";
  let shippingLine = "";
  let ratingLine = "";
  let problemsLine = "";
  let reasonLine = "";
  let partsLine = "";

  try {
    const enrichment = await fetchListingEnrichment(item.url);
    if (enrichment) {
      if (enrichment.shippingText) {
        shippingLine = `\n📦 Spedizione: ${escapeHtml(enrichment.shippingText)}`;
      }
      if (enrichment.sellerRating != null) {
        const stars = "⭐".repeat(Math.round(enrichment.sellerRating));
        ratingLine = `\n${stars} ${enrichment.sellerRating}/${enrichment.sellerRatingMax || 5}${
          enrichment.sellerUsername ? ` (${escapeHtml(enrichment.sellerUsername)})` : ""
        }`;
      }
      try {
        const summary = await summarizeListing({ title: item.title, price: item.price, text: enrichment.fullText });
        if (summary.problems) problemsLine = `\n⚠️ Problemi: ${escapeHtml(summary.problems)}`;
        if (summary.reasonForSale) reasonLine = `\n💬 Motivo vendita: ${escapeHtml(summary.reasonForSale)}`;

        const cfg = loadConfig();
        const queries = Array.isArray(summary.repairPartQueries) ? summary.repairPartQueries.filter(Boolean) : [];
        const looksRepairable = REPAIRABLE_RE.test(item.title || "") || REPAIRABLE_RE.test(summary.problems || "");
        if (cfg.repairPartsLookup !== false && queries.length && looksRepairable) {
          try {
            const parts = await findParts(queries, cfg.maxRepairParts || 3);
            if (parts.length) {
              const rows = parts.map((p) => {
                if (p.title && p.price != null) {
                  return `• ${escapeHtml(p.title.slice(0, 75))} — ~${p.price.toFixed(2)}€\n${p.url}`;
                }
                // pezzo non trovato in automatico: mostriamo comunque cosa cercare + link pronto
                return `• ${escapeHtml(p.query || "ricambio")} (cerca) \n${p.url}`;
              });
              const tot = parts.reduce((s, p) => s + (p.price || 0), 0);
              const totLine = tot > 0 ? `\n💰 Totale ricambi (trovati): ~${tot.toFixed(2)}€` : "";
              partsLine = `\n\n🔧 <b>Pezzi di ricambio</b> (Amazon.it):\n${rows.join("\n")}${totLine}`;
            }
          } catch {
            // Amazon non raggiungibile/bloccato: si manda comunque il resto
          }
        }
      } catch {
        // niente riassunto, il resto dei dettagli resta comunque utile
      }
    }
  } catch {
    // annuncio non raggiungibile: si manda comunque il messaggio base
  }

  // Il link dell'annuncio va PRIMA della sezione ricambi: se la didascalia di una foto
  // supera il limite Telegram e viene tagliata, non perdiamo comunque il link all'annuncio.
  return `${prefix}<b>${escapeHtml(item.title || "Annuncio")}</b>\n${basePrice}${shippingLine}${ratingLine}${problemsLine}${reasonLine}\n${item.url}${partsLine}`;
}

/**
 * Arricchisce una lista di annunci con una concorrenza limitata, per non aprire
 * troppe pagine Chrome in parallelo (e non far esplodere i tempi di risposta).
 */
async function enrichAndFormatItems(items, prefix = "", concurrency = 3) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await enrichAndFormatItem(items[i], prefix);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

module.exports = { enrichAndFormatItem, enrichAndFormatItems };
