// Parser a regole per i comandi/scorciatoie fissi. Ritorna un'INTENZIONE ricca
// (stessa forma di quella prodotta da Gemini in interpretRequest) oppure null se
// il testo non è una scorciatoia riconosciuta — in quel caso bot_loop.js passa a Gemini.
//
// Anche le scorciatoie portano "productDescription" ed "excludeTypes" precisi, così il
// filtro severo (selectMatchingItems) funziona identico sia per i comandi sia per le
// frasi libere: "console" non deve mai restituire giochi o accessori.

const GAMING_ACCESSORIES = ["cover", "custodie", "cavi", "caricatori", "supporti", "adesivi/skin", "solo scatola", "solo manuale"];

function parseCommand(rawText) {
  const text = rawText.trim();
  const lower = text.toLowerCase();

  if (lower === "tutto") {
    return {
      action: "search",
      searchQuery: "console playstation xbox nintendo switch controller videogiochi",
      productDescription: "qualsiasi articolo gaming: console, videogiochi o controller",
      excludeTypes: ["cover", "cavi", "caricatori", "supporti", "solo scatola", "solo manuale", "figurine", "poster"],
      label: "Tutto (gaming)",
    };
  }

  if (lower === "console") {
    return {
      action: "search",
      searchQuery: "console playstation xbox nintendo switch",
      productDescription: "una console per videogiochi come dispositivo (PlayStation, Xbox, Nintendo Switch/Wii, ecc.), NON i videogiochi e NON gli accessori",
      excludeTypes: ["videogiochi", "giochi", "controller", ...GAMING_ACCESSORIES],
      label: "Console",
    };
  }

  if (lower === "giochi" || lower === "videogiochi") {
    return {
      action: "search",
      searchQuery: "videogioco gioco ps4 ps5 xbox nintendo switch",
      productDescription: "un videogioco (il titolo/gioco su disco o cartuccia), NON console e NON accessori",
      excludeTypes: ["console", "controller", ...GAMING_ACCESSORIES],
      label: "Giochi",
    };
  }

  if (lower === "controller") {
    return {
      action: "search",
      searchQuery: "controller joypad ps4 ps5 xbox nintendo",
      productDescription: "un controller/joypad per console, NON la console e NON i giochi",
      excludeTypes: ["console", "videogiochi", "giochi", ...GAMING_ACCESSORIES],
      label: "Controller",
    };
  }

  if (lower === "controller originali") {
    return {
      action: "search",
      searchQuery: "controller originale ufficiale sony microsoft nintendo",
      productDescription: "un controller ORIGINALE/ufficiale della casa madre (Sony DualShock/DualSense, Xbox ufficiale, Joy-Con/Pro Controller Nintendo), NON compatibili di terze parti, NON console, NON giochi",
      excludeTypes: ["controller compatibile", "controller di terze parti", "console", "videogiochi", ...GAMING_ACCESSORIES],
      label: "Controller originali",
    };
  }

  let m = text.match(/^gioco\s*:\s*(.+)$/i);
  if (m) {
    const titolo = m[1].trim();
    return {
      action: "search",
      searchQuery: titolo,
      productDescription: `il videogioco "${titolo}" (il titolo su disco/cartuccia), NON console, accessori o gadget a tema`,
      excludeTypes: ["console", "controller", "gadget", "poster", "figure", "solo custodia vuota"],
      label: `Gioco: ${titolo}`,
    };
  }

  m = text.match(/^controller\s*:\s*(.+)$/i);
  if (m) {
    const consoleName = m[1].trim();
    return {
      action: "search",
      searchQuery: `controller ${consoleName} originale`,
      productDescription: `un controller/joypad per ${consoleName}, preferibilmente originale; NON la console, NON i giochi`,
      excludeTypes: ["console", "videogiochi", "giochi", ...GAMING_ACCESSORIES],
      label: `Controller ${consoleName}`,
    };
  }

  m = text.match(/^console\s*:\s*(.+)$/i);
  if (m) {
    const nome = m[1].trim();
    return {
      action: "search",
      searchQuery: nome,
      productDescription: `la console ${nome} come dispositivo, NON i videogiochi per ${nome} e NON gli accessori`,
      excludeTypes: ["videogiochi", "giochi", "controller", ...GAMING_ACCESSORIES],
      label: `Console: ${nome}`,
    };
  }

  return null;
}

module.exports = { parseCommand };
