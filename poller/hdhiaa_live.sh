#!/usr/bin/env bash
# Rask HDH-IAA-synk — kjøres fra cron hvert 2. minutt under stevnet.
# Sjekker først den lille inbox-feeden (~7 KB) mot siste kjente score-id;
# full henting (stillinger + startliste) og push skjer KUN når det finnes
# nye scorer. Deler lås med local_poll.sh slik at de aldri kjører samtidig.
set -u
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"
REPO="${REPO:-/home/paal/ianseo_feed}"
LOCK="/tmp/ianseolive-poll.lock"
LOG="/tmp/ianseolive-poll.log"

exec 9>"$LOCK"
flock -n 9 || exit 0  # en annen poll pågår

cd "$REPO" || exit 1
{
  echo "--- $(date -u +%Y-%m-%dT%H:%M:%SZ) hdhiaa live-check"
  python3 poller/hdhiaa_poll.py --live || exit 1
  git add data/hdhiaa.json hdhiaa/index.html
  if git diff --cached --quiet; then
    echo "no changes"
    exit 0
  fi
  git commit -m "Update HDH-IAA results $(date -u +%Y-%m-%dT%H:%M:%SZ) (live)"
  if ! git pull --rebase; then
    # konflikt vil være på datafiler (annen poll pushet også) —
    # ta theirs, regenerer med vår parser, fortsett
    git checkout --theirs data/results.json data/hdhiaa.json
    python3 poller/hdhiaa_poll.py
    git add data/hdhiaa.json hdhiaa/index.html
    git -c core.editor=true rebase --continue || git rebase --abort
  fi
  git push
} >>"$LOG" 2>&1
