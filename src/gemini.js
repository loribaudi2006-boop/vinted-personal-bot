const { nextApiKey } = require("./gemini_keys");

const MODEL = "gemini-3.5-flash-lite";

async function callGeminiOnce(prompt, apiKey, json) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: json ? { responseMimeType: "application/json" } : {},
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (res.status === 429) {
    const err = new Error("Gemini 429 (quota)");
    err.code = 429;
    throw err;
  }
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Risposta Gemini vuota: " + JSON.stringify(data).slice(0, 300));
  return json ? JSON.parse(text) : text;
}

// Ruota tra le chiavi disponibili; se una va in quota (429), riprova con la successiva.
async function callGemini(prompt, { json = true } = {}) {
  let lastErr;
  const attempts = 3;
  for (let i = 0; i < attempts; i++) {
    const apiKey = nextApiKey();
    try {
      return await callGeminiOnce(prompt, apiKey, json);
    } catch (e) {
      lastErr = e;
      if (e.code !== 429) throw e;
    }
  }
  throw lastErr;
}

/**
 * Motore di comprensione della chat: prende il messaggio libero dell'utente e ne
 * ricava un'intenzione strutturata e RICCA — non solo le parole chiave, ma anche una
 * descrizione precisa dell'oggetto voluto e i tipi di annuncio da scartare. Questi
 * campi servono poi a `selectMatchingItems` per non restituire mai spazzatura.
 */
async function interpretRequest(message) {
  const prompt = `Sei il motore di comprensione di un bot Telegram che cerca articoli in vendita su Vinted (qualsiasi categoria: abbigliamento, elettronica, console, videogiochi, accessori, casa...).

Messaggio dell'utente (lingua naturale, di solito italiano): "${message}"

Capisci ESATTAMENTE cosa vuole e rispondi SOLO con questo JSON:
{
  "action": "search" | "create_alert" | "chat" | "clarify",
  "searchQuery": "il testo migliore da digitare nella barra di ricerca di Vinted (solo parole chiave essenziali; niente saluti, verbi, prezzi, punteggiatura). Mantieni il livello di dettaglio dell'utente: se dice 'ps4' -> 'ps4' (NON aggiungere 'slim' o 'pro'), se dice 'ps4 slim' -> 'ps4 slim'",
  "productDescription": "UNA frase che descrive il TIPO di oggetto voluto, come istruzione per un filtro. Chiarisci se è il DISPOSITIVO, un ACCESSORIO o un GIOCO, ma NON aggiungere vincoli di modello/variante che l'utente non ha dato. Es: utente 'ps4' -> 'una console PlayStation 4, qualsiasi modello (Fat, Slim o Pro)'; utente 'ps4 slim' -> 'una console PlayStation 4 Slim'; 'un videogioco per Nintendo Switch titolo Zelda'; 'una giacca da uomo North Face'",
  "excludeTypes": ["tipi di annuncio da SCARTARE perché di categoria diversa da ciò che l'utente vuole. Es. per una console: 'videogiochi','controller','cavi','cover','solo scatola'. Vuoto [] se l'utente non è restrittivo. NON mettere qui le varianti di modello dello stesso prodotto"],
  "maxPrice": numero o null (solo se lo dice: 'sotto 200€','max 50'),
  "minPrice": numero o null,
  "condition": "nuovo" | "come nuovo" | "buone condizioni" | null (solo se citato),
  "desiredCount": numero o null (solo se dice quanti ne vuole),
  "label": "etichetta breve leggibile, es. 'PlayStation 5 Slim sotto 300€'",
  "clarifyQuestion": "se action è 'clarify': UNA domanda breve per capire cosa intende. Altrimenti ''",
  "reply": "se action è 'chat': risposta breve e naturale in italiano. Altrimenti ''"
}

Regole:
- "create_alert" SOLO se chiede di essere avvisato in futuro ('avvisami quando...','notificami se...','tienimi d'occhio').
- "search" se vuole vedere subito degli annunci (anche solo 'iphone 15' o 'console').
- "chat" per saluti, ringraziamenti, domande sul funzionamento del bot.
- "clarify" va usato RARAMENTE, solo se davvero non si capisce che categoria di oggetto voglia e cercare darebbe risultati a caso (es. solo 'nintendo', solo 'fifa'). Se l'utente nomina un prodotto riconoscibile ('ps4', 'iphone 12', 'console', 'giacca nike') NON chiedere: cerca.
- Un prodotto nominato in modo generico NON è ambiguo: 'ps4' = tutte le PS4 di qualsiasi modello. Non chiedere il modello.
- Parole generiche di categoria = loro significato più naturale: 'console' = i DISPOSITIVI (PlayStation, Xbox, Nintendo Switch...), NON i videogiochi; 'giochi'/'videogiochi' = i titoli; 'controller' = i joypad.
- "excludeTypes" serve a togliere le categorie sbagliate (giochi/accessori quando si vuole la console), NON i modelli diversi dello stesso prodotto.`;

  return callGemini(prompt);
}

/**
 * Filtro di pertinenza. Dati la descrizione del TIPO di prodotto voluto e le categorie da
 * escludere, tiene solo gli annunci che sono davvero quel prodotto (qualsiasi modello), e
 * scarta ciò che è di categoria diversa (gioco al posto della console, accessori, altro).
 * Per liste lunghe divide in blocchi così il modello valuta ogni annuncio con attenzione.
 */
async function _selectChunk({ productDescription, excludeTypes, userMessage }, items, offset) {
  const list = items
    .map((it, i) => `${offset + i + 1}. ${it.title}${it.price != null ? ` — ${it.price}€` : ""}`)
    .join("\n");
  const prompt = `Un utente su Vinted cerca: ${productDescription}
${excludeTypes && excludeTypes.length ? `Categorie da SCARTARE: ${excludeTypes.join(", ")}.` : ""}
${userMessage ? `Messaggio originale: "${userMessage}"` : ""}

Annunci (numero. titolo):
${list}

Regole:
- TIENI un annuncio se è davvero quel tipo di prodotto, di QUALSIASI modello/variante/taglia/colore (es. si cerca "PS4" -> tieni PS4 Fat, Slim, Pro; si cerca "giacca Nike" -> tieni qualsiasi giacca Nike).
- TIENI i lotti/bundle che includono il prodotto voluto.
- SCARTA se è di categoria diversa: un videogioco quando si vuole la console (o viceversa); accessori/ricambi/cover/cavi quando si vuole il prodotto principale; un prodotto completamente diverso; solo-scatola o solo-manuale.
- SCARTA se dal titolo NON si capisce che sia il prodotto voluto (titoli vaghi/fuori tema).
- Un titolo in altra lingua ma chiaramente lo stesso prodotto: TIENILO.

Rispondi SOLO con JSON: { "keep": [numeri degli annunci da tenere, come compaiono sopra] }`;

  const result = await callGemini(prompt);
  return new Set((result.keep || []).map(Number).filter((n) => Number.isFinite(n)));
}

async function selectMatchingItems(ctx, items) {
  const CHUNK = 25;
  if (items.length <= CHUNK) return _selectChunk(ctx, items, 0);

  const jobs = [];
  for (let i = 0; i < items.length; i += CHUNK) {
    jobs.push(_selectChunk(ctx, items.slice(i, i + CHUNK), i).catch(() => new Set()));
  }
  const sets = await Promise.all(jobs);
  const merged = new Set();
  sets.forEach((s) => s.forEach((n) => merged.add(n)));
  return merged;
}

/**
 * Valuta se un annuncio Vinted è probabilmente falso/esca, in base a titolo/prezzo/testo.
 */
async function assessListingAuthenticity({ title, price, referencePrice, description }) {
  const prompt = `Valuta se questo annuncio Vinted è sospetto (falso, esca per attirare click, truffa, o articolo mai destinato ad essere venduto davvero).

Titolo: ${title}
Prezzo: ${price ?? "sconosciuto"}€
Prezzo di mercato di riferimento (se noto): ${referencePrice ?? "sconosciuto"}€
Testo/descrizione (estratto pagina): ${(description || "").slice(0, 1500)}

Rispondi SOLO con un JSON:
{
  "suspicious": true|false,
  "reason": "breve motivazione in italiano"
}

Considera sospetto: richieste di pagamento fuori piattaforma, urgenza artificiale eccessiva, prezzo assurdamente basso senza alcuna spiegazione plausibile (es. rottura dichiarata), descrizioni vaghe/copiaincollate, incongruenze tra titolo e testo.
Non considerare sospetto un prezzo basso se è chiaramente spiegato da un difetto/rottura dichiarata onestamente.`;

  return callGemini(prompt);
}

/**
 * Riassume da titolo + testo pagina eventuali problemi dichiarati dal venditore
 * e il motivo della vendita, se presenti. Non inventa nulla: se non è scritto, torna null.
 */
async function summarizeListing({ title, price, text }) {
  const prompt = `Leggi questo annuncio Vinted e riassumi SOLO informazioni realmente presenti nel testo (non inventare nulla).

Titolo: ${title}
Prezzo: ${price ?? "sconosciuto"}€
Testo estratto dalla pagina: ${(text || "").slice(0, 2000)}

Rispondi SOLO con un JSON:
{
  "problems": "breve riassunto in italiano di eventuali difetti/problemi dichiarati dal venditore, o null se non ce ne sono/non è specificato",
  "reasonForSale": "breve motivo della vendita se il venditore lo scrive esplicitamente, o null se non specificato",
  "repairPartQueries": ["query di ricerca per Amazon.it dei pezzi di ricambio necessari a riparare il difetto"]
}

Regole per "repairPartQueries":
- Popola l'array SOLO se l'articolo è un dispositivo elettronico riparabile (console, controller, PC, fotocamera, drone, telefono, ecc.) E il venditore dichiara un difetto concreto risolvibile con un pezzo di ricambio (es. stick che va da solo/drifting, tasto rotto, non si accende, lettore disco KO, ventola rumorosa, batteria che non tiene, schermo rotto).
- Ogni query deve essere specifica e in italiano: includi il modello esatto + il pezzo (es. "stick analogico ricambio dualsense ps5", "alimentatore interno ps4 slim", "ventola raffreddamento nintendo switch"). Massimo 3 query.
- Lascia l'array VUOTO [] per: abbigliamento e oggetti non elettronici, difetti solo estetici (graffi, ingiallimento), o quando non c'è alcun difetto dichiarato.`;

  return callGemini(prompt);
}

module.exports = { interpretRequest, assessListingAuthenticity, selectMatchingItems, summarizeListing };
