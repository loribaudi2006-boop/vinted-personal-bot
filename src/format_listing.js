const { fetchListingEnrichment } = require("./vinted_search");
const { summarizeListing } = require("./gemini");

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
      } catch {
        // niente riassunto, il resto dei dettagli resta comunque utile
      }
    }
  } catch {
    // annuncio non raggiungibile: si manda comunque il messaggio base
  }

  return `${prefix}<b>${escapeHtml(item.title || "Annuncio")}</b>\n${basePrice}${shippingLine}${ratingLine}${problemsLine}${reasonLine}\n${item.url}`;
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
