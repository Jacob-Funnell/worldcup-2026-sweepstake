#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  Daily 8am job. Regenerates the standings snapshot (→ overnight-movers deltas),
#  pushes it to GitHub (the live site reads it from raw), and redeploys to
#  Netlify so the bundled fallback copy stays fresh too.
#  The site is ALSO live on every page load, so even if this skips a day the
#  standings stay current — only the "overnight movers" panel would lag.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
cd "/Users/jacob/Claude code/Worldcup Sweepstake" || exit 1
SITE_ID="65abc5e2-f232-4471-b813-a9276cbb91c7"

echo "▶ $(date '+%Y-%m-%d %H:%M %Z') — World Cup sweepstake morning update"

# 1) Recompute from ESPN → public/data/latest.json + a dated history snapshot.
OUT=$(node scripts/build-data.mjs 2>&1); RC=$?
echo "$OUT"
if [ $RC -ne 0 ]; then echo "✗ build-data failed — leaving previous data untouched."; exit 1; fi

# 2) Commit + push (history/<date>.json is new each day, so there's always a change).
git add -A
if ! git diff --cached --quiet; then
  git commit -q -m "Daily snapshot $(date +%F)"
  if git push -q origin main; then echo "✓ pushed to GitHub"; else echo "✗ git push failed"; exit 1; fi
else
  echo "• nothing new to commit"
fi

# 3) Redeploy the static site to Netlify (keeps the bundled fallback current).
TOKEN=$(python3 -c "import json,os;d=json.load(open(os.path.expanduser('~/Library/Preferences/netlify/config.json')));print(next(iter(d['users'].values()))['auth']['token'])" 2>/dev/null)
if [ -n "${TOKEN:-}" ]; then
  rm -f /tmp/wc_site.zip
  ( cd public && zip -rq /tmp/wc_site.zip . -x ".*" )
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "https://api.netlify.com/api/v1/sites/$SITE_ID/deploys" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/zip" --data-binary @/tmp/wc_site.zip)
  if [ "$CODE" -ge 200 ] && [ "$CODE" -lt 300 ]; then echo "✓ Netlify redeploy HTTP $CODE"; else echo "✗ Netlify redeploy failed HTTP $CODE"; exit 1; fi
else
  echo "• no Netlify token found — skipped redeploy (site still updates live)."
fi
echo "✓ done."
