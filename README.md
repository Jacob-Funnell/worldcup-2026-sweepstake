# World Cup 2026 Sweepstake 🏆⚽

A live tracker for our three-way FIFA World Cup 2026 sweepstake.

**Live site:** https://worldcup-sweepstake-26.netlify.app

| Character | Player | Colour | Teams |
|-----------|--------|--------|-------|
| 🦆 Lewis T. Duck | **Jacob** | green | 16 |
| 🐘 Arnold the Elephant | **Pete** | blue | 16 |
| ⚓ Captain Mildred | **Matt** | red | 16 |

## What's on the line
- 🏆 **The £10** — overall winner takes £10 (a fiver each from the other two).
- 🍺 **The Golden Boot** — most goals scored across your 16 teams wins a drink. A separate race, so it can go to someone else.

## How it works
- The page pulls **live scores from ESPN in your browser** on every visit, so the standings are never stale — no waiting for a refresh.
- A **daily 8am task** (UK time) recomputes a snapshot, pushes it to GitHub and redeploys, which powers the **"overnight movers"** panel ("who climbed since yesterday morning").
- No API keys, no database, no build step — just static files plus two CORS-open data feeds (ESPN + GitHub raw).

## Scoring (the £10 race)
Everything lives in [`public/app/config.mjs`](public/app/config.mjs) — change a number, push, done.

- **Match points:** 3 for a win, 1 for a draw, on *every* game a team plays (group and knockout).
- **Round bonuses** (cumulative, for reaching the stage): R32 +3 · R16 +5 · QF +8 · SF +12 · Final +16 · **Champions +25**.
- A knockout decided on penalties counts as a draw for match points, but the team that goes through still banks the next-round bonus.
- **Tie-break:** goal difference, then goals scored.

## Project layout
```
public/
  index.html            # the page shell
  styles.css            # all styling (mobile-first)
  app/
    config.mjs          # people, prizes, scoring rules  ← tweak here
    draw.mjs            # 48 teams → owner (keyed by ESPN id)
    data-source.mjs     # fetch + normalise the ESPN feed
    compute.mjs         # the scoring engine (shared by site + 8am task)
    ui.mjs              # render functions
    main.mjs            # entry point (live fetch → fallback)
  data/
    latest.json         # baked snapshot (fallback + movement)
    history/<date>.json # one per day, powers overnight movers
scripts/
  build-data.mjs        # recompute + write snapshots
  morning-update.sh     # the 8am job (build → push → redeploy)
  serve.mjs             # local preview server
```

## Running locally
```bash
npm run serve     # → http://localhost:4321
npm run build:data  # regenerate public/data/latest.json from ESPN
```

## Changing the rules / names / prizes
Edit [`public/app/config.mjs`](public/app/config.mjs), then either run `scripts/morning-update.sh`
or just `git push` and re-run the build. The site reads everything from there.

---
*Data from ESPN's public FIFA World Cup feed. Built for a minor sweepstake between three friends.*
