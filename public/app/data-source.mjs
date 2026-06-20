// ─────────────────────────────────────────────────────────────────────────────
//  Fetches the World Cup feed from ESPN and normalises it into a plain shape
//  that compute.mjs understands. Runs identically in Node 18+ and the browser
//  (both have global fetch).
// ─────────────────────────────────────────────────────────────────────────────
import { ESPN, ESPN_ROUND_LABELS } from './config.mjs';

// Pull the whole tournament (104 matches) plus the group standings, which carry
// ESPN's authoritative per-team qualification/elimination note.
export async function fetchTournament() {
  const sbUrl = `${ESPN.scoreboard}?dates=${ESPN.range}&limit=${ESPN.limit}`;
  const [sbRes, stRes] = await Promise.allSettled([
    fetch(sbUrl, { headers: { 'Accept': 'application/json' } }),
    fetch(ESPN.standings, { headers: { 'Accept': 'application/json' } }),
  ]);
  if (sbRes.status !== 'fulfilled' || !sbRes.value.ok) {
    throw new Error(`ESPN scoreboard ${sbRes.status === 'fulfilled' ? sbRes.value.status : 'unreachable'}`);
  }
  const json = await sbRes.value.json();
  let standings = {};
  if (stRes.status === 'fulfilled' && stRes.value.ok) {
    try { standings = parseStandings(await stRes.value.json()); } catch { standings = {}; }
  }
  return { ...normalise(json), standings };
}

// Two distinct ESPN signals, and they mean different things:
//   • the `advanced` stat (1) = MATHEMATICALLY clinched a knockout berth — reliable.
//   • the note `description` = the standings-table ZONE for the team's CURRENT
//     rank ("Advance to Round of 32" / "Best 8 advance" / "Eliminated"). It is
//     positional, NOT a clinch — a team that has lost one game already shows the
//     "Eliminated" zone. So we use `advanced` for hard status/bonus and the zone
//     only as a soft live indicator.
function parseStandings(json) {
  const out = {};
  for (const grp of json?.children || []) {
    for (const e of grp?.standings?.entries || []) {
      const id = e?.team?.id;
      if (!id) continue;
      const desc = (e?.note?.description || '').toLowerCase();
      let zone = null;
      if (desc.includes('eliminat')) zone = 'eliminated';
      else if (desc.includes('advance')) zone = 'advancing';
      else if (desc) zone = 'contention';
      const stat = (n) => { const s = (e.stats || []).find((x) => x.name === n); return s ? s.value : null; };
      out[id] = { zone, note: e?.note?.description || '', rank: stat('rank'), advanced: stat('advanced') === 1 };
    }
  }
  return out;
}

// Build round windows from ESPN's own calendar so stage detection self-corrects
// if a match is ever rescheduled.
function roundWindows(json) {
  const cal = json?.leagues?.[0]?.calendar?.[0]?.entries || [];
  const windows = [];
  for (const e of cal) {
    const key = ESPN_ROUND_LABELS[e.label];
    if (!key) continue;
    windows.push({ key, start: new Date(e.startDate), end: new Date(e.endDate) });
  }
  return windows;
}

function roundForDate(dateStr, windows) {
  const d = new Date(dateStr);
  for (const w of windows) if (d >= w.start && d < w.end) return w.key;
  // Fallback by hard date thresholds if calendar is missing.
  const t = d.getTime();
  if (t < Date.parse('2026-06-28T07:00Z')) return 'group';
  if (t < Date.parse('2026-07-04T07:00Z')) return 'r32';
  if (t < Date.parse('2026-07-09T07:00Z')) return 'r16';
  if (t < Date.parse('2026-07-14T07:00Z')) return 'qf';
  if (t < Date.parse('2026-07-18T07:00Z')) return 'sf';
  if (t < Date.parse('2026-07-19T07:00Z')) return 'third';
  return 'final';
}

function normalise(json) {
  const windows = roundWindows(json);
  const events = json?.events || [];
  const matches = events.map((ev) => {
    const comp = ev.competitions?.[0] || {};
    const cs = comp.competitors || [];
    const home = cs.find((c) => c.homeAway === 'home') || cs[0] || {};
    const away = cs.find((c) => c.homeAway === 'away') || cs[1] || {};
    const side = (c) => ({
      id: c?.team?.id ?? null,
      name: c?.team?.displayName ?? '',
      abbr: c?.team?.abbreviation ?? '',
      flag: c?.team?.logo ?? (c?.team?.logos?.[0]?.href ?? ''),
      score: c?.score != null && c.score !== '' ? Number(c.score) : null,
      winner: c?.winner === true,
      advance: c?.advance === true,
    });
    const status = ev.status?.type || {};
    return {
      id: ev.id,
      date: ev.date,
      state: status.state || 'pre',          // 'pre' | 'in' | 'post'
      completed: status.completed === true,
      detail: status.shortDetail || status.detail || '',
      round: roundForDate(ev.date, windows),
      home: side(home),
      away: side(away),
    };
  });
  return {
    matches,
    fetchedAt: new Date().toISOString(),
    source: 'espn',
  };
}
