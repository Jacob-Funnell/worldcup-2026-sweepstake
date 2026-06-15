// ─────────────────────────────────────────────────────────────────────────────
//  Run by the 8am task (and anytime you like): node scripts/build-data.mjs
//  Fetches ESPN, computes standings, diffs against yesterday's snapshot for the
//  "overnight movers" panel, and writes public/data/latest.json + a dated
//  history snapshot. The live site recomputes from ESPN itself; this baked file
//  is the fallback + the source of the day-over-day movement numbers.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { fetchTournament } from '../public/app/data-source.mjs';
import { compute } from '../public/app/compute.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, '..', 'public', 'data');
const HIST = join(DATA, 'history');

function londonDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(d); // YYYY-MM-DD
}

function snapshotFrom(payload, date) {
  const groupings = {};
  for (const g of payload.leaderboard) {
    groupings[g.key] = { total: g.total, gf: g.gf, gd: g.gd, rank: g.rank, bootRank: g.bootRank };
  }
  const teams = {};
  for (const t of payload.teams) teams[t.id] = { total: t.total, gf: t.gf, status: t.status, name: t.name, owner: t.owner };
  return { date, generatedAt: payload.generatedAt, matchesPlayed: payload.stats.matchesPlayed, groupings, teams };
}

function previousSnapshot(todayDate) {
  if (!existsSync(HIST)) return null;
  const files = readdirSync(HIST).filter((f) => f.endsWith('.json')).sort();
  const prior = files.filter((f) => f.replace('.json', '') < todayDate);
  if (!prior.length) return null;
  try { return JSON.parse(readFileSync(join(HIST, prior[prior.length - 1]), 'utf8')); }
  catch { return null; }
}

function movement(payload, prev) {
  if (!prev) return { since: null, groupings: {}, topMover: null, teamDeltas: [] };
  const groupings = {};
  let topMover = null, topGain = -Infinity;
  for (const g of payload.leaderboard) {
    const p = prev.groupings?.[g.key];
    const rankBefore = p?.rank ?? g.rank;
    const pointsDelta = g.total - (p?.total ?? g.total);
    const gfDelta = g.gf - (p?.gf ?? g.gf);
    groupings[g.key] = { rankBefore, rankNow: g.rank, rankDelta: rankBefore - g.rank, pointsDelta, gfDelta };
    if (pointsDelta > topGain) { topGain = pointsDelta; topMover = g.key; }
  }
  const teamDeltas = [];
  for (const t of payload.teams) {
    const p = prev.teams?.[t.id];
    const totalDelta = t.total - (p?.total ?? t.total);
    const gfDelta = t.gf - (p?.gf ?? t.gf);
    if (totalDelta > 0 || gfDelta > 0) teamDeltas.push({ id: t.id, name: t.name, owner: t.owner, flag: t.flag, totalDelta, gfDelta });
  }
  teamDeltas.sort((a, b) => b.totalDelta - a.totalDelta || b.gfDelta - a.gfDelta);
  return { since: prev.date, generatedAt: prev.generatedAt, groupings, topMover, teamDeltas: teamDeltas.slice(0, 12) };
}

async function main() {
  const today = londonDate();
  const { matches, fetchedAt } = await fetchTournament();
  if (!matches.length) throw new Error('No matches returned from ESPN — refusing to overwrite.');
  const payload = compute(matches);
  const prev = previousSnapshot(today);
  payload.movement = movement(payload, prev);
  payload.fetchedAt = fetchedAt;
  payload.dateLondon = today;

  mkdirSync(HIST, { recursive: true });
  writeFileSync(join(DATA, 'latest.json'), JSON.stringify(payload, null, 2));
  writeFileSync(join(HIST, `${today}.json`), JSON.stringify(snapshotFrom(payload, today), null, 2));

  const lead = payload.leaderboard[0];
  console.log(`✓ ${today} — ${payload.stats.matchesPlayed}/${payload.stats.matchesTotal} played. ` +
    `Leader: ${lead.character} (${lead.person}) ${lead.total} pts. ` +
    `Golden Boot: ${payload.goldenBoot[0].character} ${payload.goldenBoot[0].gf} goals.`);
}

main().catch((e) => { console.error('✗ build-data failed:', e.message); process.exit(1); });
