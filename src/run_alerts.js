const { runAlertLoopFor } = require("./alert_loop");
const { closeBrowser } = require("./vinted_search");

const durationMs = (parseInt(process.env.DURATION_SECONDS || "21000", 10)) * 1000;

runAlertLoopFor(durationMs)
  .catch((e) => console.error("run_alerts fatal:", e))
  .finally(async () => {
    await closeBrowser();
    process.exit(0);
  });
