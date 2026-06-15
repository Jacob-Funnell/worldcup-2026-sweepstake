// ─────────────────────────────────────────────────────────────────────────────
//  The scoring engine. Pure function, no I/O — same code runs in the 8am Node
//  task and live in everyone's browser, so the numbers can never disagree.
//
//  Input:  matches (from data-source), draw (TEAMS), config (SCORING etc.)
//  Output: a fully-computed payload the UI just renders.
// ─────────────────────────────────────────────────────────────────────────────
import { TEAMS } from './draw.mjs';
import { PEOPLE, PEOPLE_ORDER, SCORING, ROUND_META } from './config.mjs';

const KO_ORDER = ['r32', 'r16', 'qf', 'sf', 'final']; // progression ladder (3rd-place excluded)
const BONUS_FOR = { r32: 'r32', r16: 'r16', qf: 'qf', sf: 'sf', final: 'final' };

export function compute(matches) {
  const byId = new Map(TEAMS.map((t) => [t.id, { ...t,
    played: 0, wins: 0, draws: 0, losses: 0, gf: 0, ga: 0,
    matchPoints: 0, bonusPoints: 0, reached: new Set(['group']),
    champion: false, matches: [],
  }]));

  // Which real (drawn) team ids appear in each knockout round → "reached" detection.
  const reachedKO = { r32: new Set(), r16: new Set(), qf: new Set(), sf: new Set(), final: new Set() };
  let finalPlayed = false;

  for (const m of matches) {
    const sides = [m.home, m.away];
    // Reached-a-round detection: a drawn team simply appearing in a KO fixture
    // (even if still upcoming) means they got there. Placeholders have unknown ids.
    if (KO_ORDER.includes(m.round)) {
      for (const s of sides) if (s.id && byId.has(s.id)) reachedKO[m.round].add(s.id);
      if (m.round === 'final' && m.state === 'post') finalPlayed = true;
    }

    // Only score matches that have started (in-progress counts live).
    if (m.state === 'pre') continue;
    const hs = m.home.score, as = m.away.score;
    if (hs == null || as == null) continue;

    for (const [self, opp] of [[m.home, m.away], [m.away, m.home]]) {
      if (!self.id || !byId.has(self.id)) continue;
      const t = byId.get(self.id);
      const finished = m.state === 'post';
      t.matches.push({
        oppName: opp.name, oppFlag: opp.flag, round: m.round,
        gf: self.score, ga: opp.score, state: m.state, detail: m.detail, date: m.date,
        result: self.score > opp.score ? 'W' : self.score < opp.score ? 'L' : 'D',
      });
      // Count goals always; count W/D/L + points only once final (avoids double-moving on live).
      t.gf += self.score; t.ga += opp.score;
      if (finished) {
        t.played += 1;
        if (self.score > opp.score) { t.wins += 1; t.matchPoints += SCORING.matchPoints.win; }
        else if (self.score < opp.score) { t.losses += 1; t.matchPoints += SCORING.matchPoints.loss; }
        else { t.draws += 1; t.matchPoints += SCORING.matchPoints.draw; }
        // Champion: won the final.
        if (m.round === 'final' && self.winner) { t.champion = true; }
      }
    }
  }

  // Apply reached-round sets + bonuses.
  for (const round of KO_ORDER) {
    for (const id of reachedKO[round]) {
      const t = byId.get(id);
      if (t) { t.reached.add(round); t.bonusPoints += SCORING.roundBonus[BONUS_FOR[round]]; }
    }
  }
  for (const t of byId.values()) {
    if (t.champion) t.bonusPoints += SCORING.roundBonus.champion;
  }

  // Has the knockout bracket been drawn yet? (any real team in an R32 fixture)
  const bracketDrawn = reachedKO.r32.size > 0;

  // Per-team derived fields.
  const teams = [];
  for (const t of byId.values()) {
    const gd = t.gf - t.ga;
    const total = t.matchPoints + t.bonusPoints;
    const furthest = furthestRound(t.reached, t.champion);
    const status = teamStatus(t, matches, reachedKO, bracketDrawn);
    teams.push({
      id: t.id, name: t.name, abbr: t.abbr, group: t.group, owner: t.owner, flag: t.flag,
      played: t.played, wins: t.wins, draws: t.draws, losses: t.losses,
      gf: t.gf, ga: t.ga, gd, matchPoints: t.matchPoints, bonusPoints: t.bonusPoints,
      total, furthest, furthestLabel: ROUND_META[furthest]?.label || 'Group stage',
      champion: t.champion, status, matches: t.matches,
    });
  }
  teams.sort((a, b) => b.total - a.total || b.gd - a.gd || b.gf - a.gf || a.name.localeCompare(b.name));

  // Per-grouping aggregation.
  const groupings = PEOPLE_ORDER.map((key) => {
    const mine = teams.filter((t) => t.owner === key);
    const agg = mine.reduce((a, t) => {
      a.matchPoints += t.matchPoints; a.bonusPoints += t.bonusPoints; a.total += t.total;
      a.gf += t.gf; a.ga += t.ga; a.played += t.played;
      a.wins += t.wins; a.draws += t.draws; a.losses += t.losses;
      if (t.status === 'out') a.out += 1; else if (t.champion) { a.alive += 1; a.champions += 1; }
      else a.alive += 1;
      return a;
    }, { matchPoints: 0, bonusPoints: 0, total: 0, gf: 0, ga: 0, played: 0,
         wins: 0, draws: 0, losses: 0, alive: 0, out: 0, champions: 0 });
    agg.gd = agg.gf - agg.ga;
    const best = [...mine].sort((a, b) => b.total - a.total || b.gd - a.gd)[0] || null;
    const flop = pickFlop(mine);
    return { ...PEOPLE[key], ...agg, teams: mine, best, flop };
  });

  // Leaderboard (main £10 race): total points, then GD, then GF.
  const leaderboard = [...groupings].sort(
    (a, b) => b.total - a.total || b.gd - a.gd || b.gf - a.gf
  );
  leaderboard.forEach((g, i) => { g.rank = i + 1; });

  // Golden Boot race (bonus drink): most goals.
  const goldenBoot = [...groupings].sort((a, b) => b.gf - a.gf || b.gd - a.gd);
  goldenBoot.forEach((g, i) => { g.bootRank = i + 1; });

  // Tournament-wide fun stats.
  const startedTeams = teams.filter((t) => t.played > 0);
  const bestPerformer = teams[0] || null;
  const topScorerTeam = [...teams].sort((a, b) => b.gf - a.gf || b.gd - a.gd)[0] || null;
  const biggestFlop = overallFlop(teams);
  const counts = matchCounts(matches);

  return {
    generatedAt: new Date().toISOString(),
    bracketDrawn,
    tournamentOver: teams.some((t) => t.champion),
    leaderboard, goldenBoot, groupings, teams,
    stats: { bestPerformer, topScorerTeam, biggestFlop, ...counts, startedTeams: startedTeams.length },
  };
}

function furthestRound(reached, champion) {
  if (champion) return 'final';
  let best = 'group';
  for (const r of ['final', 'sf', 'qf', 'r16', 'r32', 'group']) {
    if (reached.has(r)) { best = r; break; }
  }
  return best;
}

// A team is OUT if it lost a knockout tie, or the bracket is drawn and it didn't make it.
function teamStatus(t, matches, reachedKO, bracketDrawn) {
  if (t.champion) return 'champion';
  // Lost a knockout match (post, not winner) → eliminated.
  for (const m of matches) {
    if (m.state !== 'post' || m.round === 'group' || m.round === 'third') continue;
    for (const [self, opp] of [[m.home, m.away], [m.away, m.home]]) {
      if (self.id === t.id && !self.winner && (opp.id && opp.id !== self.id)) {
        // ensure it was a real decided tie (someone won)
        if (opp.winner || (self.score != null && opp.score != null && self.score < opp.score)) return 'out';
      }
    }
  }
  // Group team that didn't make a drawn bracket → out.
  const inKO = reachedKO.r32.has(t.id) || reachedKO.r16.has(t.id) || reachedKO.qf.has(t.id) ||
               reachedKO.sf.has(t.id) || reachedKO.final.has(t.id);
  if (bracketDrawn && !inKO) return 'out';
  return 'alive';
}

// Per-grouping flop: an out team with the worst points-per-game (most disappointing).
function pickFlop(mine) {
  const out = mine.filter((t) => t.status === 'out' && t.played > 0);
  if (!out.length) return null;
  return out.sort((a, b) => (a.total / a.played) - (b.total / b.played) || a.gd - b.gd)[0];
}

// Tournament flop: the eliminated team that scored fewest points for games played.
function overallFlop(teams) {
  const out = teams.filter((t) => t.status === 'out' && t.played > 0);
  if (!out.length) return null;
  return out.sort((a, b) => a.total - b.total || a.gd - b.gd)[0];
}

function matchCounts(matches) {
  let played = 0, live = 0, upcoming = 0;
  for (const m of matches) {
    if (m.state === 'post') played += 1;
    else if (m.state === 'in') live += 1;
    else upcoming += 1;
  }
  return { matchesPlayed: played, matchesLive: live, matchesUpcoming: upcoming, matchesTotal: matches.length };
}
