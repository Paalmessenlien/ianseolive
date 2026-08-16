#!/usr/bin/env bash
# Local poller for ianseolive — run from cron on the maintainer's machine.
# Faster than the GitHub Actions schedule (which is delayed up to ~30 min
# under load): poll (~5 s) + push + Pages deploy (~45 s) ≈ 1 min to live.
# The Actions workflow in .github/workflows/poll.yml remains as a fallback
# for when this machine is off.
set -u
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"
REPO="${REPO:-/home/paal/ianseo_feed}"
LOCK="/tmp/ianseolive-poll.lock"
LOG="/tmp/ianseolive-poll.log"

exec 9>"$LOCK"
flock -n 9 || exit 0  # previous run still going

cd "$REPO" || exit 1
{
  echo "--- $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  python3 poller/poll.py || exit 1
  git add data/results.json index.html
  if git diff --cached --quiet; then
    echo "no changes"
    exit 0
  fi
  git commit -m "Update results $(date -u +%Y-%m-%dT%H:%M:%SZ) (local)"
  if ! git pull --rebase; then
    # conflict will be on data/results.json (Actions bot pushed too) —
    # take theirs, regenerate with our parser, continue
    git checkout --theirs data/results.json
    python3 poller/poll.py
    git add data/results.json index.html
    git -c core.editor=true rebase --continue || git rebase --abort
  fi
  git push
} >>"$LOG" 2>&1
