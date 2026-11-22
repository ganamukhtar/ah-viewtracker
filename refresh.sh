#!/usr/bin/env bash
# Collect public numbers for every account in accounts.json and publish data/snapshot.json to main.
# Usage: ./refresh.sh            collect + commit + push (needs git push access)
#        ./refresh.sh --no-push  collect only
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.local/bin:$PATH"
command -v yt-dlp >/dev/null || python3 -m pip install --user --break-system-packages -q -U yt-dlp
git pull --rebase --autostash -q origin main || true
COLLECT_DELAY_MS="${COLLECT_DELAY_MS:-800}" node collector/run.js
[ "${1:-}" = "--no-push" ] && exit 0
git add data/snapshot.json accounts.json
if git diff --cached --quiet; then echo "No change to publish"; exit 0; fi
git -c user.name=ganamukhtar -c user.email=ganamukh@gmail.com commit -q -m "Refresh numbers $(date -u +%Y-%m-%dT%H:%MZ)"
if GIT_TERMINAL_PROMPT=0 git push -q origin HEAD:main; then
  echo "Published. Vercel redeploys in about a minute."
else
  echo "Push failed: this machine has no GitHub write access. The commit is local; push it from a machine that does, or let the GitHub Action publish." >&2
  exit 2
fi
