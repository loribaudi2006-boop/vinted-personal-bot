# Vinted Personal Bot

Bot Telegram personale, indipendente e multi-utente per cercare e monitorare console, videogiochi e controller su Vinted. Ogni persona che scrive al bot ha le proprie ricerche/avvisi salvati separatamente (per `chatId`) — nessuna interferenza tra utenti o dispositivi diversi.

Riusa la stessa tecnica di scraping già collaudata nel progetto Vinted Deal Finder (nessun login, nessuna evasione anti-bot: Chrome headless che naviga le pagine pubbliche come un utente normale), ma è un progetto completamente separato, con proprio repository, bot Telegram e chiave Gemini.

## Cosa sa fare (testi da mettere su BotFather)

BotFather ha due campi separati con limiti di lunghezza diversi: l'**About** (max 120 caratteri, visibile sul profilo del bot) e la **Description** (max 512 caratteri, visibile a chi apre la chat per la prima volta, prima di premere Start).

### About — imposta con `/setabouttext`
```
🔎 Cerco qualsiasi prodotto su Vinted per te, su richiesta o con avvisi automatici in tempo reale.
```

### Description — imposta con `/setdescription`
```
Scrivimi un prodotto e lo cerco su Vinted (es. "iphone 12", "giacca sotto 40€").

Scorciatoie: console, giochi, controller, gioco: <titolo>, controller: <console>, console: <nome>, tutto.

Per essere avvisato: "avvisami quando trovi una ps5 sotto 200€" - controllo spesso, scrivo solo per annunci nuovi e affidabili.

/help - guida ai comandi
/list - i tuoi avvisi attivi, numerati
/remove 2 - cancella l'avviso col numero indicato da /list

Ricerche e avvisi sono personali per ogni utente.
```

### Cosa fanno esattamente `/help`, `/list` e `/remove`
Sono comandi che l'utente scrive nella chat come un messaggio qualsiasi (non pulsanti):

- **`/help`** — il bot risponde con la guida completa ai comandi (lo stesso contenuto della Description, richiamabile in ogni momento).
- **`/list`** — mostra l'elenco numerato degli **avvisi automatici** attivi dell'utente, quelli creati scrivendo frasi tipo "avvisami quando...". Esempio di risposta:
  ```
  1. PS5 sotto 200€ — ricerca "ps5", sotto 200€
  2. Giacca North Face sotto 40€ — ricerca "giacca north face", sotto 40€
  ```
- **`/remove <numero>`** — cancella uno degli avvisi mostrati da `/list`, usando il numero di quella lista (es. `/remove 2` cancella l'avviso #2). Da quel momento il bot smette di controllarlo e non arrivano più notifiche per quello. Un avviso creato resta attivo per sempre finché non viene rimosso così — `/list` serve proprio per non perderne traccia nel tempo.

## Architettura

```
Telegram (long polling, getUpdates)
        │
        ▼
  bot_loop.js  ──► commands.js (regole fisse, gratis)
        │              │
        │              └─(fallback)──► gemini.js (interpretazione libera)
        │
        └─► vinted_search.js (scraping pubblico, Chrome headless)

  alert_loop.js (ogni ~90s per ogni alert di ogni utente)
        ├─► vinted_search.js
        ├─► fake_detector.js (euristica + gemini.js) — scarta annunci sospetti
        └─► telegram.js (invia solo le novità, con foto)

  store.js — data/users/<chatId>.json (stato isolato per utente)
```

I due loop (`bot_loop` per i messaggi, `alert_loop` per i controlli periodici) girano **in parallelo** dentro allo stesso job GitHub Actions, esattamente come nel Vinted Deal Finder: un job dura ~5h50m, poi un cron ogni 6 ore ne fa ripartire uno nuovo. Lo stato (`data/*.json`) viene committato su Git ogni 10 minuti così sopravvive al riavvio del job.

## File principali
- `src/commands.js` — riconosce i comandi fissi richiesti (`console`, `giochi`, `controller`, `gioco: X`, `controller: X`, `console: X`, `controller originali`, `tutto`) senza usare Gemini (zero costo/quota).
- `src/gemini.js` — usato SOLO come fallback quando un messaggio non corrisponde a un comando fisso (per capire richieste libere e filtri extra come "pagamento solo su Vinted"), e per valutare l'autenticità di un annuncio prima di un alert.
- `src/fake_detector.js` — prima un controllo euristico gratuito (sconto anomalo rispetto a un prezzo di riferimento, frasi sospette tipo "pagamento fuori piattaforma"), poi se non trova nulla chiede un secondo parere a Gemini prima di inviare l'alert.
- `src/vinted_search.js` — scraping della pagina pubblica di ricerca Vinted (`vinted.it/catalog?search_text=...`), stessa tecnica del progetto precedente.
- `src/store.js` — un file JSON per utente (`data/users/<chatId>.json`) con i suoi alert salvati e gli annunci già visti (per non ri-notificare due volte lo stesso articolo).
- `src/bot_loop.js` — ascolta i messaggi in arrivo (long polling) e risponde.
- `src/alert_loop.js` — ogni ciclo, per ogni utente, per ogni suo alert, cerca novità entro il prezzo massimo, scarta i sospetti, notifica.

## Passaggi per metterlo in funzione (gratis, 24/7, anche a PC spento)

### 1. Crea il bot Telegram
1. Apri Telegram, cerca **@BotFather**, scrivi `/newbot`.
2. Dagli un nome e uno username (deve finire in "bot", es. `VintedPersonalFinderBot`).
3. BotFather ti dà un **token** (tipo `123456:ABC-...`) — salvalo.
4. Sempre con BotFather: `/setdescription` e `/setabouttext` → incolla il testo della bio qui sopra, così chi apre il bot capisce subito come usarlo.

### 2. Crea una chiave Gemini separata (consigliato)
1. Vai su [Google AI Studio](https://aistudio.google.com/) con lo stesso account che usi già.
2. Crea un **nuovo progetto** (non riusare quello del Vinted Deal Finder) e genera una nuova API key lì dentro.
   - Perché un progetto nuovo: la quota gratuita di Gemini è per-progetto, non per-account. Con un progetto separato questo bot ha la sua quota indipendente e non intacca quella dell'altro bot.

### 3. Prova in locale (facoltativo ma consigliato prima di pubblicare)
```bash
cd VintedPersonalBot
npm install
```
Crea un file `.env` (copia `.env.example`) con dentro:
```
TELEGRAM_BOT_TOKEN=il-tuo-token
GEMINI_API_KEY=la-tua-chiave
```
Poi avvia un test rapido (60 secondi di ascolto):
```bash
node -e "require('dotenv').config(); const {runBotLoopFor}=require('./src/bot_loop'); runBotLoopFor(60000).then(()=>process.exit(0))"
```
Scrivi `console` al tuo bot su Telegram e verifica che risponda.

### 4. Metti il codice su GitHub
```bash
git init
git add .
git commit -m "Vinted Personal Bot - primo commit"
gh repo create vinted-personal-bot --public --source=. --push
```

### 5. Configura i secret su GitHub (token e chiavi, mai nel codice)
```bash
gh secret set TELEGRAM_BOT_TOKEN --body "il-tuo-token"
gh secret set GEMINI_API_KEY_1 --body "prima-chiave"
gh secret set GEMINI_API_KEY_2 --body "seconda-chiave"
gh secret set GEMINI_API_KEY_3 --body "terza-chiave"
```
(3 chiavi = quota Gemini circa triplicata rispetto a una sola — il bot ruota automaticamente tra le tre)

### 6. Avvia il primo run e verifica
```bash
gh workflow run bot.yml
```
Dopo un paio di minuti, controlla la tab **Actions** del repo su GitHub: dovresti vedere il job in esecuzione. Scrivi al bot su Telegram (`/help`, poi `console`) e verifica che risponda entro pochi secondi.

Da qui in poi il bot gira da solo ogni 6 ore, 24/7, senza bisogno del PC acceso — esattamente come il Vinted Deal Finder.

## Pezzi di ricambio automatici

Quando il bot trova un annuncio di un dispositivo elettronico (console, controller, PC, fotocamera…) in cui il venditore **dichiara un difetto riparabile**, cerca da solo i pezzi di ricambio necessari su **Amazon.it** e li aggiunge in fondo al messaggio, con titolo, prezzo reale, link diretto e totale stimato. Vale sia per le ricerche su richiesta sia per gli avvisi automatici. Per oggetti non elettronici o difetti solo estetici non fa nulla. Si disattiva mettendo `"repairPartsLookup": false` in `config.json` (`"maxRepairParts"` regola quanti pezzi cercare, default 3).

## Watchdog (auto-riavvio + avviso su Telegram)

`watchdog.yml` è un secondo workflow che gira ogni ~15 minuti (job minuscolo, senza Chrome). Controlla che `bot.yml` sia attivo: se GitHub non ha avviato il job programmato e il bot è fermo da più di 20 minuti, **manda un messaggio su Telegram che spiega il problema e riavvia il bot da solo**. Se due job di fila falliscono, avvisa soltanto (niente riavvio automatico, per non entrare in loop). Richiede il secret `TELEGRAM_CHAT_ID` oltre a `TELEGRAM_BOT_TOKEN`.

## Limiti onesti da sapere
- **Non è "istantaneo" H24**: dentro ogni job di 6 ore il bot ascolta i messaggi ogni ~3 secondi (quasi in tempo reale), ma tra un job e l'altro (avvio del job successivo) può esserci un piccolo buco di qualche minuto ogni 6 ore — stesso compromesso già accettato per il Vinted Deal Finder.
- **Rilevamento "fake"**: è un aiuto, non una garanzia — combina regole euristiche (sconto troppo aggressivo, frasi sospette) e il giudizio di Gemini sul testo dell'annuncio, ma nessun sistema automatico è infallibile contro chi pubblica annunci in mala fede.
- **Nessun login su Vinted**: il bot legge solo pagine pubbliche di ricerca, come faresti tu da browser — per questo non può vedere messaggi privati o fare azioni sul tuo account.
