const puppeteer = require("puppeteer-core");
const { loadConfig } = require("./config_loader");

let sharedBrowser = null;

async function getBrowser() {
  if (sharedBrowser && sharedBrowser.isConnected()) return sharedBrowser;
  const { chromePath } = loadConfig();
  sharedBrowser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  return sharedBrowser;
}

async function closeBrowser() {
  if (sharedBrowser) {
    await sharedBrowser.close().catch(() => {});
    sharedBrowser = null;
  }
}

// Parole tipiche di accessori/pertinenze che spesso "inquinano" una ricerca generica
// (es. cercando "iphone 15" escono anche cover, cavi, auricolari; cercando "ps5"
// escono giochi/cavi invece della console). Una parola viene esclusa SOLO se non
// compare già nella richiesta dell'utente, così una ricerca intenzionale tipo
// "cover iphone 15" o "gioco: fifa 23" non viene mai filtrata.
// Vinted.it mostra anche annunci di venditori esteri con titoli in altre lingue,
// quindi la lista include gli equivalenti più comuni in inglese/francese/tedesco/olandese/spagnolo.
const NOISE_WORDS = [
  // cover/custodia
  "cover", "custodia", "custodie", "coque", "hoesje", "hoesjes", "hülle", "huelle", "funda",
  // pellicola/vetro protettivo
  "pellicola", "pellicole", "vetro temperato", "vetro protettivo", "proteggi schermo",
  "screenprotector", "screen protector", "displayschutz", "protection ecran", "protection écran",
  // auricolari/cuffie
  "auricolari", "cuffie", "earbuds", "headphones", "kopfhörer", "koptelefoon", "casque", "écouteurs", "ecouteurs",
  // caricatore/cavo/adattatore
  "caricatore", "caricabatterie", "cavo", "cavetto", "cable", "câble", "kabel",
  "adattatore", "adapter", "adaptateur", "charger", "chargeur", "ladegerät",
  // varie
  "supporto", "case", "protezione", "adesivo", "sticker", "skin",
  "powerbank", "power bank", "portachiavi",
  // gioco/giochi (per non-console) in più lingue
  "gioco", "giochi", "videogioco", "videogiochi", "joystick", "manuale",
  "game", "games", "jeu", "jeux", "spiel", "spiele", "juego", "juegos",
  "solo scatola", "solo confezione",
];

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildExclusionList(query) {
  const q = query.toLowerCase();
  return NOISE_WORDS.filter((w) => !q.includes(w));
}

function isNoisyTitle(title, exclusionList) {
  const t = title.toLowerCase();
  return exclusionList.some((w) => new RegExp(`\\b${escapeRegex(w)}\\b`, "i").test(t));
}

/**
 * Cerca su Vinted (pagina pubblica dei risultati, come farebbe un utente normale).
 * @param {string} query testo di ricerca libero
 * @param {object} opts { maxItems, filterNoise }
 */
async function searchVinted(query, opts = {}) {
  const { maxResultsPerSearch } = loadConfig();
  const maxItems = opts.maxItems || maxResultsPerSearch;
  const filterNoise = opts.filterNoise !== false;
  const url = `https://www.vinted.it/catalog?search_text=${encodeURIComponent(
    query
  )}&order=newest_first`;

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    );
    // "domcontentloaded" invece di "networkidle2": Vinted continua a caricare tracker/pubblicità
    // in background per parecchi secondi, e aspettarli tutti rallenta inutilmente ogni ricerca.
    // Aspettiamo solo che la griglia dei risultati sia effettivamente in pagina.
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page
      .waitForSelector('[data-testid^="grid-item"], .feed-grid__item', { timeout: 8000 })
      .catch(() => {});

    const items = await page.evaluate(() => {
      const cards = Array.from(
        document.querySelectorAll('[data-testid^="grid-item"], .feed-grid__item')
      );
      return cards
        .map((card) => {
          const link = card.querySelector("a[href*='/items/']");
          if (!link) return null;
          const href = link.getAttribute("href");
          const idMatch = href && href.match(/\/items\/(\d+)/);
          const img = card.querySelector("img");
          const altText = img ? img.getAttribute("alt") || "" : "";
          return {
            id: idMatch ? idMatch[1] : href,
            url: href && href.startsWith("http") ? href : `https://www.vinted.it${href}`,
            altText,
            photoUrl: img ? img.src : null,
          };
        })
        .filter(Boolean);
    });

    const parsed = items
      .map((it) => {
        // L'attributo alt ha la forma: "Titolo, Brand: X, Condizioni: Y, 70.00 €, 74.20 €"
        // (i prezzi qui usano il punto come separatore decimale, non le migliaia)
        const parts = it.altText.split(",").map((p) => p.trim());
        const title = parts[0] || "";
        const priceMatch = it.altText.match(/(\d+\.\d{2})\s*€/);
        return {
          id: it.id,
          url: it.url,
          title,
          priceText: priceMatch ? priceMatch[0] : "",
          price: priceMatch ? parseFloat(priceMatch[1]) : null,
          photoUrl: it.photoUrl,
        };
      })
      .filter((it) => it.id && it.title);

    if (!filterNoise) return parsed.slice(0, maxItems);

    const exclusionList = buildExclusionList(query);
    const clean = parsed.filter((it) => !isNoisyTitle(it.title, exclusionList));
    // Se il filtro toglie troppo (query molto di nicchia), meglio mostrare qualcosa
    // che niente: si torna ai risultati grezzi solo se quelli puliti sono troppo pochi.
    const finalList = clean.length >= Math.min(3, maxItems) ? clean : parsed;
    return finalList.slice(0, maxItems);
  } finally {
    await page.close().catch(() => {});
  }
}

function parsePrice(text) {
  if (!text) return null;
  const match = text.replace(/\./g, "").replace(",", ".").match(/(\d+(\.\d+)?)/);
  return match ? parseFloat(match[1]) : null;
}

/**
 * Apre la pagina di un singolo annuncio e ne estrae il testo utile (descrizione, venditore).
 */
async function fetchListingDetails(url) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    const text = await page.evaluate(() => document.body.innerText.slice(0, 3000));
    return text;
  } catch {
    return "";
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Apre la pagina di un singolo annuncio ed estrae i dettagli strutturati: spedizione,
 * stelle del venditore e testo completo (per far riassumere a Gemini problemi/motivo vendita).
 */
async function fetchListingEnrichment(url) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    );
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForSelector('[data-testid="profile-username"]', { timeout: 6000 }).catch(() => {});

    return await page.evaluate(() => {
      const shippingEl = document.querySelector('[data-testid="item-shipping-banner-price"]');
      const ratingEl = document.querySelector(".web_ui__Rating__rating");
      const ratingLabel = ratingEl ? ratingEl.getAttribute("aria-label") || "" : "";
      const ratingMatch = ratingLabel.match(/([\d.,]+)\s*su\s*([\d.,]+)/i);
      const sellerEl = document.querySelector('[data-testid="profile-username"]');
      return {
        shippingText: shippingEl ? shippingEl.innerText.trim() : null,
        sellerRating: ratingMatch ? parseFloat(ratingMatch[1].replace(",", ".")) : null,
        sellerRatingMax: ratingMatch ? parseFloat(ratingMatch[2].replace(",", ".")) : null,
        sellerUsername: sellerEl ? sellerEl.innerText.trim() : null,
        fullText: document.body.innerText.slice(0, 2500),
      };
    });
  } catch {
    return null;
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = { searchVinted, fetchListingDetails, fetchListingEnrichment, closeBrowser, parsePrice };
