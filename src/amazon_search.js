// Cerca un pezzo di ricambio su Amazon.it e restituisce il primo risultato NON
// sponsorizzato con titolo, prezzo reale e link diretto pulito (amazon.it/dp/ASIN).
// Nessuna chiamata a Gemini: e' scraping puro sulla pagina pubblica dei risultati,
// quindi costo zero token e prezzi/link sempre veri (letti dalla pagina, non stimati).
//
// NOTA: dai runner GitHub Actions (IP da datacenter) Amazon mostra spesso prima una
// pagina di consenso cookie che nasconde la griglia dei risultati. Qui la chiudiamo
// esplicitamente e, se serve, ricarichiamo. Se comunque non arriva nulla si restituisce
// null (il chiamante mostra allora solo un link di ricerca gia' pronto).

const { getBrowser } = require("./vinted_search");

const CONSENT_SELECTORS = [
  "#sp-cc-rejectall",
  'input[data-cel-widget="sp-cc-rejectall"]',
  "#sp-cc-accept",
  'input[name="accept"]',
  'button[name="glowDoneButton"]',
];

async function dismissConsent(page) {
  for (const sel of CONSENT_SELECTORS) {
    const btn = await page.$(sel).catch(() => null);
    if (btn) {
      await btn.click().catch(() => {});
      await page.waitForNetworkIdle({ timeout: 8000 }).catch(() => {});
      return true;
    }
  }
  return false;
}

async function readResults(page) {
  await page.waitForSelector('[data-component-type="s-search-result"]', { timeout: 12000 }).catch(() => {});
  return page.evaluate(() => {
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
}

function amazonSearchUrl(query) {
  return "https://www.amazon.it/s?k=" + encodeURIComponent(query);
}

async function searchAmazonPart(query) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    );
    await page.setExtraHTTPHeaders({ "Accept-Language": "it-IT,it;q=0.9,en;q=0.8" });
    try {
      await page.setCookie(
        { name: "i18n-prefs", value: "EUR", domain: ".amazon.it" },
        { name: "lc-acbit", value: "it_IT", domain: ".amazon.it" }
      );
    } catch {}

    const url = "https://www.amazon.it/s?k=" + encodeURIComponent(query) + "&language=it_IT";
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

    let results = await readResults(page);
    if (!results.length && (await dismissConsent(page))) {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
      results = await readResults(page);
    }
    if (!results.length) return null;

    const best = results.find((r) => !r.sponsored && r.title && r.priceText && r.asin);
    if (!best) return null;

    return { query, title: best.title, price: parseFloat(best.priceText), url: `https://www.amazon.it/dp/${best.asin}` };
  } catch {
    return null;
  } finally {
    await page.close().catch(() => {});
  }
}

// Cerca in sequenza (una tab Amazon per volta e' piu' gentile e meno soggetta a blocchi)
// fino a `max` pezzi. Per i pezzi non trovati resta comunque un link di ricerca pronto.
async function findParts(queries, max = 3) {
  const out = [];
  for (const q of (queries || []).slice(0, max)) {
    const r = await searchAmazonPart(q);
    if (r) {
      if (!out.some((p) => p.url === r.url)) out.push(r);
    } else {
      out.push({ query: q, title: null, price: null, url: amazonSearchUrl(q), estimated: true });
    }
  }
  return out;
}

module.exports = { searchAmazonPart, findParts, amazonSearchUrl };
