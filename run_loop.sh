#!/usr/bin/env bash
set -uo pipefail

DURATION_SECONDS=${DURATION_SECONDS:-21000} # ~5h50m di default
COMMIT_INTERVAL_SECONDS=${COMMIT_INTERVAL_SECONDS:-600}

echo "Avvio bot per ${DURATION_SECONDS}s..."

DURATION_SECONDS=$DURATION_SECONDS node src/run_bot.js &
BOT_PID=$!

DURATION_SECONDS=$DURATION_SECONDS node src/run_alerts.js &
ALERTS_PID=$!

commit_data() {
  if ! git diff --quiet -- data/ || ! git diff --cached --quiet -- data/; then
    git add data/
    git -c user.email="bot@vintedpersonalbot" -c user.name="VintedPersonalBot" commit -m "sync stato bot" >/dev/null 2>&1
    git push >/dev/null 2>&1 || echo "push fallito, riproverò al prossimo ciclo"
  fi
}

END_TIME=$((SECONDS + DURATION_SECONDS))
while [ $SECONDS -lt $END_TIME ]; do
  sleep "$COMMIT_INTERVAL_SECONDS"
  commit_data
done

wait $BOT_PID
wait $ALERTS_PID
commit_data

echo "Ciclo terminato."
