const path = require("path");
const { loadConfig } = require("./config_loader");
const { sendMessage, sendPhoto, getUpdates } = require("./telegram");
const { searchVinted } = require("./vinted_search");
const { parseCommand } = require("./commands");
const { interpretRequest, selectMatchingItems } = require("./gemini");
const { enrichAndFormatItems } = require("./format_listing");
const store = require("./store");
const { readJsonSafe, atomicWriteJson } = require("./lock");

const OFFSET_FILE = path.join(__dirname, "..", "data", "telegram_offset.json");

const HELP_TEXT = `<b>Ricerca libera</b>
Scrivimi il nome di QUALSIASI prodotto e te lo cerco subito su Vinted — non solo gaming, va bene qualunque cosa (es. <code>giacca north face</code>, <code>iphone 12</code>, <code>lego star wars</code>).
Puoi anche scrivere frasi naturali tipo "cercami un iphone 15 a meno di 300 euro almeno 5 risultati" — capisco prezzo massimo e numero minimo di risultati.

<b>Scorciatoie gaming</b>
• <code>console</code> / <code>giochi</code> / <code>controller</code> — categorie rapide
• <code>controller originali</code> — solo controller ufficiali
• <code>gioco: &lt;titolo&gt;</code> (es. <code>gioco: fifa 23</code>)
• <code>controller: &lt;console&gt;</code> (es. <code>controller: ps4</code>)
• <code>console: &lt;nome&gt;</code> (es. <code>console: ps5 slim</code>)
• <code>tutto</code> — cerca in tutte le categorie gaming

<b>Avvisi automatici</b>
Scrivi in linguaggio naturale, es:
"avvisami quando esce una ps5 sotto i 200€"
"notificami se trovi una giacca north face sotto 40€, come nuova"
Il bot controlla Vinted ogni pochi minuti e ti avvisa solo per annunci nuovi, filtrando quelli sospetti/falsi.

<b>Gestione avvisi</b>
• <code>/list</code> — mostra l'elenco numerato dei tuoi avvisi attivi (quelli creati con "avvisami quando..."), così non ne perdi traccia nel tempo
• <code>/remove &lt;numero&gt;</code> — rimuove un avviso, usando il numero mostrato da <code>/list</code> (es. <code>/remove 2</code>). Da quel momento il bot smette di controllarlo
• <code>/help</code> — mostra di nuovo questa guida

Un avviso creato resta attivo per sempre finché non lo rimuovi tu con <code>/remove</code>.
Ogni utente ha i propri avvisi: le tue ricerche non influenzano quelle di nessun altro.`;

const GREETING_RE = /^(ciao|hey|hei|ehi|salve|yo|hola|buongiorno|buonasera|buondì)[!.,\s]*$/i;
const GREETING_PREFIX_RE = /^(ciao|hey|hei|ehi|salve|yo|hola|buongiorno|buonasera|buondì)[,!.\s]+/i;
const FILLER_VERB_RE = /^(cercami|cerca|trovami|trova|dammi|mostrami|voglio|vorrei)\s+(un'|una|un|il|lo|la|gli|le|dei|degli|delle|i)?\s*/i;
const MAX_PRICE_RE = /(?:a\s+meno\s+di|meno\s+di|inferiore\s+a|sotto\s+i?|max(?:imo)?|entro\s+i?)\s*(\d+(?:[.,]\d+)?)\s*(?:€|euro)?/i;
const RESULT_COUNT_RE = /(?:almeno\s+)?(\d+)\s*(?:risultati|annunci|articoli|oggetti|opzioni)/i;
const RESULT_COUNT_CAP = 15;

// Ripulisce frasi naturali ("ciao, cercami un iphone 15...") in una query di ricerca pulita,
// senza usare Gemini — per tenere le ricerche istantanee e a costo zero.
function cleanQuery(text) {
  let t = text.trim();
  t = t.replace(GREETING_PREFIX_RE, "");
  t = t.replace(FILLER_VERB_RE, "");
  return t.trim();
}

function extractMaxPrice(text) {
  const m = text.match(MAX_PRICE_RE);
  return m ? parseFloat(m[1].replace(",", ".")) : null;
}

function stripPricePhrase(text) {
  return text.replace(MAX_PRICE_RE, "").replace(/\s{2,}/g, " ").trim();
}

function extractResultCount(text) {
  const m = text.match(RESULT_COUNT_RE);
  if (!m) return null;
  return Math.min(parseInt(m[1], 10), RESULT_COUNT_CAP);
}

function stripResultCountPhrase(text) {
  return text.replace(RESULT_COUNT_RE, "").replace(/\s{2,}/g, " ").trim();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

async function handleSearchReply(chatId, intent) {
  const cfg = loadConfig();
  const label = intent.label || intent.searchQuery;
  const showCount = intent.desiredCount || cfg.maxResultsPerSearch || 15;
  const maxPrice = intent.maxPrice || null;
  const minPrice = intent.minPrice || null;

  await sendMessage(chatId, `🔎 Cerco: <b>${escapeHtml(label)}</b>…`);

  const ctx = {
    productDescription: intent.productDescription || intent.searchQuery,
    excludeTypes: intent.excludeTypes || [],
    userMessage: intent.userMessage,
  };

  // Cerchiamo pagina per pagina su Vinted finché non abbiamo abbastanza annunci DAVVERO
  // pertinenti (non solo "trovati"). Ci fermiamo quando: ne abbiamo a sufficienza, Vinted
  // non ha più risultati, o abbiamo guardato MAX_PAGES pagine. Il filtro di pertinenza
  // (severo, a blocchi) gira su ogni pagina, così ogni annuncio mostrato è correlato.
  const MAX_PAGES = 4;
  const seenIds = new Set();
  let kept = [];
  let totalRaw = 0;
  let searchFailed = false;

  for (let pageNum = 1; pageNum <= MAX_PAGES && kept.length < showCount; pageNum++) {
    if (pageNum === 2) {
      await sendMessage(chatId, "🔍 Pochi risultati in prima pagina, cerco più a fondo…");
    }

    let raw;
    try {
      raw = await searchVinted(intent.searchQuery, { maxItems: 60, maxPrice, minPrice, page: pageNum });
    } catch {
      if (pageNum === 1) searchFailed = true;
      break;
    }

    const fresh = raw.filter((it) => it.id && !seenIds.has(String(it.id)));
    fresh.forEach((it) => seenIds.add(String(it.id)));
    totalRaw += fresh.length;
    if (!fresh.length) break; // Vinted non ha altre pagine

    let pass = fresh;
    try {
      const keep = await selectMatchingItems(ctx, fresh);
      pass = fresh.filter((_, i) => keep.has(i + 1));
    } catch {
      // Gemini non disponibile: teniamo i risultati già ripuliti localmente (meno preciso)
    }
    kept.push(...pass);

    if (fresh.length < 15) break; // ultima pagina di Vinted (parziale): inutile chiederne altre
  }

  if (searchFailed) {
    await sendMessage(chatId, "⚠️ Errore durante la ricerca su Vinted, riprova tra poco.");
    return;
  }

  let items = kept;
  const rawCount = totalRaw;

  if (!items.length) {
    await sendMessage(
      chatId,
      rawCount
        ? `Ho guardato più pagine ma nessun annuncio era davvero ciò che cerchi${maxPrice ? ` entro ${maxPrice}€` : ""}. Prova a cambiare le parole di ricerca.`
        : `Nessun annuncio${maxPrice ? ` sotto ${maxPrice}€` : ""} al momento. Riprova più tardi o allarga la ricerca.`
    );
    return;
  }

  // Sicurezza: Vinted a volte include comunque qualche annuncio fuori fascia.
  if (minPrice) items = items.filter((it) => it.price == null || it.price >= minPrice);
  if (maxPrice) items = items.filter((it) => it.price == null || it.price <= maxPrice);

  // Prima i più economici quando c'è un tetto di prezzo (è quasi sempre ciò che interessa),
  // altrimenti l'ordine di Vinted (più recenti).
  if (maxPrice) items.sort((a, b) => (a.price ?? 1e9) - (b.price ?? 1e9));

  items = items.slice(0, showCount);

  // Apriamo ogni annuncio per spedizione/stelle venditore/eventuali problemi dichiarati:
  // richiede qualche secondo in più rispetto a una lista "grezza", ma il dettaglio in più
  // vale l'attesa.
  await sendMessage(chatId, `📋 Trovati ${items.length} annunci pertinenti, sto raccogliendo i dettagli (spedizione, venditore, eventuali difetti)…`);
  const captions = await enrichAndFormatItems(items);
  for (let i = 0; i < items.length; i++) {
    if (items[i].photoUrl) {
      await sendPhoto(chatId, items[i].photoUrl, captions[i]);
    } else {
      await sendMessage(chatId, captions[i]);
    }
  }
}

async function handleListAlerts(chatId) {
  const user = store.getUser(chatId);
  if (!user.alerts.length) {
    await sendMessage(chatId, "Non hai nessun avviso attivo. Scrivimi ad esempio: \"avvisami quando esce una ps5 sotto i 200€\".");
    return;
  }
  const lines = user.alerts.map(
    (a, i) => `${i + 1}. <b>${escapeHtml(a.label)}</b> — ricerca "${escapeHtml(a.query)}"${a.maxPrice ? `, sotto ${a.maxPrice}€` : ""}`
  );
  await sendMessage(chatId, `<b>I tuoi avvisi:</b>\n${lines.join("\n")}\n\nUsa /remove &lt;numero&gt; per rimuoverne uno.`);
}

async function handleRemoveAlert(chatId, indexArg) {
  const user = store.getUser(chatId);
  const idx = parseInt(indexArg, 10) - 1;
  if (isNaN(idx) || !user.alerts[idx]) {
    await sendMessage(chatId, "Numero non valido. Usa /list per vedere i tuoi avvisi.");
    return;
  }
  const alert = user.alerts[idx];
  store.removeAlert(chatId, alert.id);
  await sendMessage(chatId, `Rimosso: ${escapeHtml(alert.label)}`);
}

async function handleMessage(chatId, text) {
  const trimmed = text.trim();

  if (trimmed === "/start" || trimmed === "/help") {
    await sendMessage(chatId, HELP_TEXT);
    return;
  }
  if (GREETING_RE.test(trimmed)) {
    await sendMessage(chatId, "Ciao! 👋 Scrivimi il nome di un prodotto da cercare su Vinted, oppure /help per vedere tutto quello che so fare.");
    return;
  }
  if (trimmed === "/list") {
    await handleListAlerts(chatId);
    return;
  }
  const removeMatch = trimmed.match(/^\/remove\s+(\d+)/);
  if (removeMatch) {
    await handleRemoveAlert(chatId, removeMatch[1]);
    return;
  }

  // Scorciatoie fisse (es. "console", "gioco: fifa 23"): niente chiamata di
  // interpretazione, ma l'intenzione che producono è comunque ricca (descrizione
  // precisa + tipi da escludere), così il filtro severo lavora identico.
  const shortcut = parseCommand(trimmed);
  if (shortcut) {
    await handleSearchReply(chatId, { ...shortcut, userMessage: trimmed });
    return;
  }

  // Ogni altro messaggio passa da Gemini per capire ESATTAMENTE cosa vuole l'utente:
  // tipo di prodotto, cosa escludere, prezzo, quantità, e se è una ricerca-adesso, un
  // avviso-futuro, una chiacchiera o una richiesta ambigua da chiarire.
  let intent;
  try {
    intent = await interpretRequest(trimmed);
  } catch (e) {
    // Gemini non disponibile (quota/rete): rete di sicurezza locale minima, solo regex.
    const desiredCount = extractResultCount(trimmed);
    const withoutCount = desiredCount ? stripResultCountPhrase(trimmed) : trimmed;
    const cleaned = cleanQuery(withoutCount);
    const maxPrice = extractMaxPrice(cleaned);
    const query = stripPricePhrase(cleaned);
    if (!query) {
      await sendMessage(chatId, "Al momento non riesco a interpretare bene la richiesta (servizio IA non disponibile). Scrivimi solo il nome di un prodotto, o /help per i comandi.");
      return;
    }
    await handleSearchReply(chatId, { searchQuery: query, label: query, maxPrice, desiredCount, userMessage: trimmed });
    return;
  }

  intent.userMessage = trimmed;

  if (intent.action === "clarify") {
    await sendMessage(chatId, `❓ ${escapeHtml(intent.clarifyQuestion || "Puoi essere più preciso su cosa cerchi?")}`);
    return;
  }

  if (intent.action === "create_alert") {
    const alert = store.addAlert(chatId, {
      label: intent.label || intent.searchQuery,
      query: intent.searchQuery,
      productDescription: intent.productDescription || "",
      excludeTypes: intent.excludeTypes || [],
      maxPrice: intent.maxPrice || null,
      minPrice: intent.minPrice || null,
    });
    // "Semina" subito gli annunci esistenti come già-visti, così il primo giro
    // dell'alert_loop non li manda tutti insieme come se fossero nuovi.
    try {
      const existing = await searchVinted(alert.query, { maxItems: 20 });
      store.markSeen(chatId, alert.id, existing.map((it) => it.id));
    } catch {
      // se la ricerca iniziale fallisce, il prossimo ciclo considererà nuovo tutto
    }
    await sendMessage(
      chatId,
      `✅ Avviso creato: <b>${escapeHtml(alert.label)}</b>${alert.maxPrice ? ` sotto ${alert.maxPrice}€` : ""}.\nTi scriverò solo per i NUOVI annunci pubblicati da adesso in poi. Usa /list per vedere i tuoi avvisi.`
    );
  } else if (intent.action === "search") {
    await handleSearchReply(chatId, intent);
  } else if (intent.action === "chat") {
    await sendMessage(chatId, intent.reply || "Ciao! Scrivimi il nome di un prodotto da cercare, o /help per vedere cosa so fare.");
  } else {
    await sendMessage(chatId, intent.reply || "Non ho capito bene. Scrivimi il nome di un prodotto, o /help per i comandi.");
  }
}

async function pollOnce() {
  const state = readJsonSafe(OFFSET_FILE, { offset: 0 });
  const updates = await getUpdates(state.offset);
  for (const update of updates) {
    state.offset = update.update_id + 1;
    const msg = update.message;
    if (!msg || !msg.text) continue;
    try {
      await handleMessage(msg.chat.id, msg.text);
    } catch (e) {
      console.error("Errore gestendo messaggio:", e.message);
    }
  }
  if (updates.length) atomicWriteJson(OFFSET_FILE, state);
}

async function runBotLoopFor(durationMs) {
  const { pollUpdatesIntervalSec } = loadConfig();
  const end = Date.now() + durationMs;
  while (Date.now() < end) {
    await pollOnce().catch((e) => console.error("pollOnce error:", e.message));
    await new Promise((r) => setTimeout(r, pollUpdatesIntervalSec * 1000));
  }
}

module.exports = { pollOnce, runBotLoopFor, handleMessage };
