// Parser a regole per i comandi fissi richiesti. Ritorna { query, label } o null se non riconosciuto.
// Il chiamante (bot_loop.js) usa Gemini come fallback quando questo ritorna null.

function parseCommand(rawText) {
  const text = rawText.trim();
  const lower = text.toLowerCase();

  if (lower === "tutto") {
    return { type: "search", query: "console videogiochi controller", label: "Tutto" };
  }

  if (lower === "console") {
    return { type: "search", query: "console", label: "Console" };
  }

  if (lower === "giochi") {
    return { type: "search", query: "giochi", label: "Giochi" };
  }

  if (lower === "controller") {
    return { type: "search", query: "controller", label: "Controller" };
  }

  if (lower === "controller originali") {
    return { type: "search", query: "controller originale ufficiale", label: "Controller originali" };
  }

  let m = text.match(/^gioco\s*:\s*(.+)$/i);
  if (m) {
    const titolo = m[1].trim();
    return { type: "search", query: titolo, label: `Gioco: ${titolo}` };
  }

  m = text.match(/^controller\s*:\s*(.+)$/i);
  if (m) {
    const consoleName = m[1].trim();
    return {
      type: "search",
      query: `controller ${consoleName} originale ufficiale`,
      label: `Controller ${consoleName}`,
    };
  }

  m = text.match(/^console\s*:\s*(.+)$/i);
  if (m) {
    const nome = m[1].trim();
    return { type: "search", query: nome, label: `Console: ${nome}` };
  }

  return null;
}

module.exports = { parseCommand };
