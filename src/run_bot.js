const { runBotLoopFor } = require("./bot_loop");
const { closeBrowser } = require("./vinted_search");

const durationMs = (parseInt(process.env.DURATION_SECONDS || "21000", 10)) * 1000;

runBotLoopFor(durationMs)
  .catch((e) => console.error("run_bot fatal:", e))
  .finally(async () => {
    await closeBrowser();
    process.exit(0);
  });
