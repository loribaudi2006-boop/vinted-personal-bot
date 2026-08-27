// Cerca un pezzo di ricambio su Amazon.it e restituisce il primo risultato NON
// sponsorizzato con titolo, prezzo reale e link diretto pulito (amazon.it/dp/ASIN).
// Nessuna chiamata a Gemini: e' scraping puro sulla pagina pubblica dei risultati,
// quindi costo zero token e prezzi/link sempre veri (letti dalla pagina, non stimati).
// Stessa tecnica gia' collaudata nel progetto Vinted Deal Finder.

const { getBrowser } = require("./vinted_search");

async function searchAmazonPart(query) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    );
    await page.setExtraHTTPHeaders({ "Accept-Language": "it-IT,it;q=0.9,en;q=0.8" });

    const url = "https://www.amazon.it/s?k=" + encodeURIComponent(query);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector('[data-component-type="s-search-result"]', { timeout: 15000 }).catch(() => {});

    const blocked = await page.evaluate(() => {
      const t = document.body.innerText.slice(0, 500).toLowerCase();
      return t.includes("inserisci i caratteri") || t.includes("robot check") || t.includes("automated access");
    });
    if (blocked) return null;

    const results = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('[data-component-type="s-search-result"]'));
      return items.map((el) => {
        const sponsored = !!el.querySelector('.puis-sponsored-label-text, [data-component-type="sp-sponsored-result"]');
        const titleEl = el.querySelector("h2 span, h2 a span");
        const priceWhole = el.querySelector(".a-price .a-price-whole");
        const priceFraction = el.querySelector(".a-price .a-price-fraction");
        const asin = el.getAttribute("data-asin");
        return {
          sponsored,
          title: titleEl ? titleEl.textContent.trim() : null,
          priceText: priceWhole
            ? priceWhole.textContent.replace(/[^\d]/g, "") + "." + (priceFraction ? priceFraction.textContent.replace(/[^\d]/g, "") : "00")
            : null,
          asin,
        };
      });
    });

    const best = results.find((r) => !r.sponsored && r.title && r.priceText && r.asin);
    if (!best) return null;

    return { query, title: best.title, price: parseFloat(best.priceText), url: `https://www.amazon.it/dp/${best.asin}` };
  } catch {
    return null;
  } finally {
    await page.close().catch(() => {});
  }
}

// Cerca in sequenza (non in parallelo: una tab Amazon per volta e' piu' gentile e
// meno soggetta a blocchi) fino a `max` pezzi. Scarta i risultati non trovati.
async function findParts(queries, max = 3) {
  const out = [];
  for (const q of (queries || []).slice(0, max)) {
    const r = await searchAmazonPart(q);
    if (r && !out.some((p) => p.url === r.url)) out.push(r);
  }
  return out;
}

module.exports = { searchAmazonPart, findParts };
