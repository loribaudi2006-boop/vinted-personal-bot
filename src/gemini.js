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
 * Interpreta QUALSIASI messaggio libero dell'utente e lo trasforma in un'azione strutturata.
 * È il motore di interpretazione principale della chat (i comandi fissi tipo "console" restano
 * gestiti localmente perché già inequivocabili, per non sprecare una chiamata inutile).
 */
async function interpretFreeText(message) {
  const prompt = `Sei il motore di interpretazione di un bot Telegram che cerca QUALSIASI tipo di articolo in vendita su Vinted (abbigliamento, elettronica, console, giochi, accessori, casa, ecc. — non solo gaming).
L'utente ha scritto questo messaggio in italiano (o comunque in una lingua naturale): "${message}"

Decidi l'azione. Rispondi SOLO con un JSON con questa forma esatta:
{
  "action": "search" | "create_alert" | "chat" | "unknown",
  "query": "testo di ricerca da usare su Vinted (solo le parole chiave essenziali del prodotto, es. 'ps5 slim', senza saluti/verbi/prezzi)",
  "maxPrice": numero_o_null,
  "desiredCount": numero_o_null,
  "extraFilters": ["eventuali filtri extra in linguaggio naturale, es. 'solo pagamento su Vinted', 'come nuovo'"],
  "label": "etichetta breve leggibile per questa ricerca/alert",
  "reply": "una risposta breve e naturale in italiano, usata SOLO se action è 'chat' o 'unknown' (es. un saluto, o una richiesta di chiarimento se il messaggio è ambiguo)"
}

Regole:
- Usa "create_alert" solo se l'utente chiede esplicitamente di essere avvisato/notificato in futuro (es. "avvisami quando...", "notificami se...", "tienimi d'occhio...").
- Usa "search" se l'utente vuole vedere subito dei prodotti in vendita su Vinted (anche se scritto come frase naturale, es. "cercami un iphone 15 sotto 300 euro" o semplicemente "iphone 15").
- Usa "chat" per saluti, ringraziamenti, o messaggi conversazionali che non richiedono una ricerca (es. "ciao", "grazie", "come funzioni?").
- Usa "unknown" se il messaggio è ambiguo o non chiaro.
- "maxPrice" va estratto solo se l'utente indica esplicitamente un prezzo massimo (es. "sotto i 200€", "a meno di 50 euro" -> quel numero).
- "desiredCount" va estratto solo se l'utente indica esplicitamente quanti risultati vuole (es. "almeno 5 risultati", "dammene 10" -> quel numero), altrimenti null.`;

  return callGemini(prompt);
}

/**
 * Rivede una lista di annunci trovati su Vinted e scarta quelli non davvero pertinenti
 * alla ricerca dell'utente (accessori/pertinenze, prodotti diversi, annunci in altre lingue
 * che il filtro locale a parole chiave non ha riconosciuto).
 */
async function filterRelevantItems(query, items) {
  const list = items.map((it, i) => `${i + 1}. ${it.title} — ${it.price != null ? it.price + "€" : "prezzo n.d."}`).join("\n");
  const prompt = `L'utente sta cercando su Vinted: "${query}"

Ecco gli annunci trovati (numerati):
${list}

Indica quali numeri sono DAVVERO pertinenti alla ricerca — cioè lo stesso tipo di prodotto cercato, non accessori/pertinenze (cover, cavi, custodie, caricatori, ecc.) né prodotti diversi (es. un gioco quando si cerca la console).
Se un annuncio è scritto in un'altra lingua ma è comunque lo stesso prodotto, includilo.
Se non sei sicuro su un annuncio, includilo comunque (meglio un falso positivo che perdere un affare vero).

Rispondi SOLO con un JSON: { "relevantIndices": [1, 3, 5] } (numeri 1-based dalla lista sopra).`;

  const result = await callGemini(prompt);
  return new Set(result.relevantIndices || []);
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

module.exports = { interpretFreeText, assessListingAuthenticity, filterRelevantItems, summarizeListing };
