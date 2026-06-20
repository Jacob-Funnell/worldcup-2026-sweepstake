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

export function compute(matches, standings = {}) {
  const byId = new Map(TEAMS.map((t) => [t.id, { ...t,
    played: 0, wins: 0, draws: 0, losses: 0, gf: 0, ga: 0,
    matchPoints: 0, bonusPoints: 0, reached: new Set(['group']),
    champion: false, matches: [],
  }]));

  // Which real (drawn) team ids appear in each knockout round → "reached" detection.
  const reachedKO = { r32: new Set(), r16: new Set(), qf: new Set(), sf: new Set(), final: new Set() };
  let finalPlayed = false;

  // A team that ESPN marks `advanced` has MATHEMATICALLY clinched its R32 spot
  // (not just sitting in a qualifying position) — treat that as having reached
  // R32, so the +3 bonus is awarded on a real clinch and never bounces around.
  for (const [id, s] of Object.entries(standings)) {
    if (s?.advanced && byId.has(id)) reachedKO.r32.add(id);
  }

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
        // Champion: won the final (only once the match is officially completed).
        if (m.round === 'final' && self.winner && m.completed) { t.champion = true; }
      }
    }
  }

  // Apply round bonuses cumulatively from the DEEPEST round a team reached.
  // Working from the deepest stage down (rather than per-appearance) means a
  // single missing/mis-binned earlier fixture can't silently drop a bonus.
  for (const t of byId.values()) {
    let deepest = -1;
    KO_ORDER.forEach((round, idx) => { if (reachedKO[round].has(t.id)) deepest = idx; });
    for (let i = 0; i <= deepest; i++) {
      const round = KO_ORDER[i];
      t.reached.add(round);
      t.bonusPoints += SCORING.roundBonus[round];
    }
    if (t.champion) t.bonusPoints += SCORING.roundBonus.champion;
  }

  // bracketDrawn = any real team has entered R32. bracketFull = ALL 32 qualifiers
  // are known (16 fixtures fully populated). We only call group teams "out" once
  // the field is FULL — otherwise a qualified team whose R32 slot is still a
  // placeholder during the rolling group→KO transition would look eliminated.
  const bracketDrawn = reachedKO.r32.size > 0;
  const bracketFull = reachedKO.r32.size >= 32;

  // Group-stage standings, ranked with the real FIFA 2026 tiebreakers
  // (points → head-to-head → overall GD → overall goals). Used for the group
  // tables and for the elimination check below.
  const gStats = groupStatsOf(byId, matches);
  const groupTeams = {};
  for (const t of byId.values()) (groupTeams[t.group] ||= []).push(t.id);
  const groupRank = {};
  for (const g in groupTeams) {
    rankGroupOrder(groupTeams[g], gStats, matches).forEach((id, i) => { groupRank[id] = i + 1; });
  }
  // Prefer ESPN's official rank where present — it already applies every
  // tiebreaker (head-to-head, GD, goals, AND the fair-play / FIFA-ranking ones
  // that aren't in the feed). Our computed head-to-head order is the fallback.
  for (const id in groupRank) {
    if (standings[id]?.rank != null) groupRank[id] = standings[id].rank;
  }

  // Knocked out of contention: a team that can NO LONGER finish in the top 2 of
  // its group. Enumerates every win/draw/loss outcome of the remaining group
  // fixtures and resolves points-ties by head-to-head — a team is out if no
  // outcome leaves ≤1 team above it. A team that still nicks a best-third place
  // is overridden to "through" by ESPN's advanced flag / the bracket below.
  const top2Out = top2EliminatedSet(byId, matches);

  // When did each group finish? (latest completed group match) — used to date a
  // team's "reached R32" bonus at the moment it actually qualified, so the trend
  // line attributes the bonus correctly instead of to the future-dated KO fixture.
  const groupLastDate = {};
  for (const m of matches) {
    if (m.round !== 'group' || m.state !== 'post') continue;
    const g = byId.get(m.home.id)?.group || byId.get(m.away.id)?.group;
    if (g && (!groupLastDate[g] || m.date > groupLastDate[g])) groupLastDate[g] = m.date;
  }
  const lastDateInRound = (t, round) => {
    let d = null;
    for (const mm of t.matches) if (mm.round === round && mm.state === 'post' && (!d || mm.date > d)) d = mm.date;
    return d;
  };
  const reachDatesFor = (t) => {
    const rd = {};
    // Team's latest completed match — the guaranteed-non-null fallback so a
    // reached round's bonus is NEVER dropped from the trend (which would make
    // the last point disagree with the leaderboard).
    let latest = null;
    for (const mm of t.matches) if (mm.state === 'post' && (!latest || mm.date > latest)) latest = mm.date;
    for (let i = 0; i < KO_ORDER.length; i++) {
      const R = KO_ORDER[i];
      if (!t.reached.has(R)) continue;
      // Reached R32 = qualified from the group (group's last completed match).
      // Reached a deeper round = won the prior KO round (that match's date).
      rd[R] = (R === 'r32'
        ? (groupLastDate[t.group] || lastDateInRound(t, 'group'))
        : (lastDateInRound(t, KO_ORDER[i - 1]) || rd[KO_ORDER[i - 1]])) || latest;
    }
    if (t.champion) rd.champion = lastDateInRound(t, 'final') || rd.final || latest;
    return rd;
  };

  // Per-team derived fields.
  const teams = [];
  for (const t of byId.values()) {
    const gd = t.gf - t.ga;
    const total = t.matchPoints + t.bonusPoints;
    const furthest = furthestRound(t.reached, t.champion);
    const status = teamStatus(t, matches, standings, reachedKO, bracketFull, top2Out);
    const gs = gStats[t.id] || { pts: 0, gd: 0, gf: 0 };
    teams.push({
      id: t.id, name: t.name, abbr: t.abbr, group: t.group, owner: t.owner, flag: t.flag,
      played: t.played, wins: t.wins, draws: t.draws, losses: t.losses,
      gf: t.gf, ga: t.ga, gd, matchPoints: t.matchPoints, bonusPoints: t.bonusPoints,
      total, furthest, furthestLabel: ROUND_META[furthest]?.label || 'Group stage',
      champion: t.champion, status, matches: t.matches, reachedDates: reachDatesFor(t),
      groupPts: gs.pts, groupGd: gs.gd, groupGf: gs.gf, groupRank: groupRank[t.id] || 0,
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
      if (isOut(t.status)) a.out += 1;
      else { a.alive += 1; if (t.status === 'through') a.through += 1; if (t.status === 'champion') a.champions += 1; }
      return a;
    }, { matchPoints: 0, bonusPoints: 0, total: 0, gf: 0, ga: 0, played: 0,
         wins: 0, draws: 0, losses: 0, alive: 0, out: 0, through: 0, champions: 0 });
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

// Leaders-over-time. Reconstructs cumulative standings at the end of each
// match-day from the start of the tournament — so the trend line is real from
// day one even though daily snapshots only began later.
//
// Built from ONE compute() pass (single source of truth for the numbers), then
// re-bucketed by date: match points/goals are attributed to the day a game was
// played, and round bonuses to the day a team actually qualified for that stage
// (reachedDates) — NOT the future-dated knockout fixture. This guarantees the
// last point of every line equals the live leaderboard.
export function computeSeries(matches, standings = {}) {
  const dayOf = (iso) => String(iso).slice(0, 10); // UTC calendar day
  const full = compute(matches, standings);
  const days = [...new Set(matches.filter((m) => m.state !== 'pre').map((m) => dayOf(m.date)))].sort();
  const series = {};
  for (const key of PEOPLE_ORDER) series[key] = { points: [], goals: [] };
  const ptsFor = (r) => r === 'W' ? SCORING.matchPoints.win : r === 'D' ? SCORING.matchPoints.draw : SCORING.matchPoints.loss;

  for (const d of days) {
    const tot = {};
    for (const k of PEOPLE_ORDER) tot[k] = { points: 0, goals: 0 };
    for (const t of full.teams) {
      const own = tot[t.owner];
      if (!own) continue;
      for (const mm of t.matches) {
        if (dayOf(mm.date) > d) continue;
        own.goals += mm.gf;                                   // goals count once a game kicks off
        if (mm.state === 'post') own.points += ptsFor(mm.result);
      }
      for (const R of KO_ORDER) {
        const rd = t.reachedDates?.[R];
        if (rd && dayOf(rd) <= d) own.points += SCORING.roundBonus[R];
      }
      if (t.champion && t.reachedDates?.champion && dayOf(t.reachedDates.champion) <= d) {
        own.points += SCORING.roundBonus.champion;
      }
    }
    for (const k of PEOPLE_ORDER) { series[k].points.push(tot[k].points); series[k].goals.push(tot[k].goals); }
  }
  return { days, series };
}

// Day-over-day movement, computed live from the trend series (NOT the daily
// snapshot, which depends on the cron). Compares the last two match-days for
// rank/points changes, and lists the teams that actually played on the latest
// match-day. Always current — never falsely "no change".
export function deriveMovement(payload, matches) {
  const empty = { since: null, asOf: null, groupings: {}, topMover: null, recent: [] };
  const s = payload?.series;
  const days = s?.days || [];
  if (!days.length) return empty;
  const last = days.length - 1, prev = last - 1;
  const ptsOn = (k, i) => s.series[k]?.points[i] ?? 0;
  const gfOn = (k, i) => s.series[k]?.goals[i] ?? 0;
  const rankOn = (i) => {
    const arr = PEOPLE_ORDER.map((k) => ({ k, pts: ptsOn(k, i), gf: gfOn(k, i) }))
      .sort((a, b) => b.pts - a.pts || b.gf - a.gf);
    const r = {}; arr.forEach((x, idx) => { r[x.k] = idx + 1; }); return r;
  };
  // rankNow comes from the authoritative leaderboard (same points→GD→goals
  // tiebreak the cards show); rankBefore is approximated from the prior day's
  // series (points→goals) — close enough for "did they climb overnight".
  const rNow = {}; for (const g of payload.leaderboard || []) rNow[g.key] = g.rank;
  const rBefore = prev >= 0 ? rankOn(prev) : { ...rNow };
  const groupings = {}; let topMover = null, topGain = 0;
  for (const k of PEOPLE_ORDER) {
    const pNow = ptsOn(k, last), pBefore = prev >= 0 ? ptsOn(k, prev) : pNow;
    const pointsDelta = pNow - pBefore, gfDelta = gfOn(k, last) - (prev >= 0 ? gfOn(k, prev) : gfOn(k, last));
    const rn = rNow[k] ?? rankOn(last)[k];
    groupings[k] = { pointsNow: pNow, pointsDelta, gfDelta, rankNow: rn, rankBefore: rBefore[k], rankDelta: rBefore[k] - rn };
    if (pointsDelta > topGain) { topGain = pointsDelta; topMover = k; }
  }
  // Teams that played on the latest match-day (what actually happened).
  const dayOf = (iso) => String(iso).slice(0, 10);
  const lastDay = days[last];
  const byId = new Map((payload.teams || []).map((t) => [t.id, t]));
  const recent = [];
  for (const m of matches || []) {
    if (m.state === 'pre' || dayOf(m.date) !== lastDay) continue;
    for (const [self, opp] of [[m.home, m.away], [m.away, m.home]]) {
      const t = byId.get(self.id);
      if (!t || self.score == null || opp.score == null) continue;
      const result = self.score > opp.score ? 'W' : self.score < opp.score ? 'L' : 'D';
      recent.push({ id: self.id, name: t.name, flag: t.flag, owner: t.owner, result,
        gf: self.score, ga: opp.score, oppName: opp.name,
        pts: m.state === 'post' ? (result === 'W' ? SCORING.matchPoints.win : result === 'D' ? SCORING.matchPoints.draw : SCORING.matchPoints.loss) : 0,
        live: m.state === 'in' });
    }
  }
  recent.sort((a, b) => b.pts - a.pts || b.gf - a.gf);
  return { since: prev >= 0 ? days[prev] : null, asOf: lastDay, groupings, topMover, recent };
}

function furthestRound(reached, champion) {
  if (champion) return 'final';
  let best = 'group';
  for (const r of ['final', 'sf', 'qf', 'r16', 'r32', 'group']) {
    if (reached.has(r)) { best = r; break; }
  }
  return best;
}

// Per-team status — "out" means genuinely knocked out, never current position:
//   champion — won the final
//   through  — clinched a knockout place (ESPN advanced=1, or already in the KO bracket)
//   out      — lost a knockout tie, OR can no longer finish top 2 of the group,
//              OR the full bracket is drawn and this team isn't in it
//   alive    — still in it (the default)
function teamStatus(t, matches, standings, reachedKO, bracketFull, top2Out) {
  if (t.champion) return 'champion';
  // Lost a knockout match (post, not winner) → out.
  for (const m of matches) {
    if (m.state !== 'post' || m.round === 'group' || m.round === 'third') continue;
    for (const [self, opp] of [[m.home, m.away], [m.away, m.home]]) {
      if (self.id === t.id && !self.winner && (opp.id && opp.id !== self.id)) {
        if (opp.winner || (self.score != null && opp.score != null && self.score < opp.score)) return 'out';
      }
    }
  }
  const inKO = reachedKO.r32.has(t.id) || reachedKO.r16.has(t.id) || reachedKO.qf.has(t.id) ||
               reachedKO.sf.has(t.id) || reachedKO.final.has(t.id);
  // Clinched (or already in the bracket as a best-third) → through, even if they
  // can't win the group. This override keeps qualified thirds from showing "out".
  if (standings[t.id]?.advanced || inKO) return 'through';
  if (top2Out.has(t.id)) return 'out';               // can't reach the top 2 anymore
  if (bracketFull && !inKO) return 'out';            // groups finished, didn't make the cut
  return 'alive';
}

export const isOut = (status) => status === 'out';

// Overall group-stage stats (from completed group matches only).
function groupStatsOf(byId, matches) {
  const s = {};
  for (const t of byId.values()) s[t.id] = { pts: 0, gf: 0, ga: 0, gd: 0, name: t.name };
  for (const m of matches) {
    if (m.round !== 'group' || m.state !== 'post') continue;
    const hs = m.home.score, as = m.away.score;
    if (hs == null || as == null) continue;
    if (byId.has(m.home.id)) { const r = s[m.home.id]; r.gf += hs; r.ga += as; r.gd += hs - as; r.pts += hs > as ? 3 : hs === as ? 1 : 0; }
    if (byId.has(m.away.id)) { const r = s[m.away.id]; r.gf += as; r.ga += hs; r.gd += as - hs; r.pts += as > hs ? 3 : as === hs ? 1 : 0; }
  }
  return s;
}

// Head-to-head points/GD/goals among a SET of teams (their completed mutual
// group matches only).
function h2hAmong(ids, matches) {
  const set = new Set(ids);
  const rec = {};
  for (const id of ids) rec[id] = { pts: 0, gd: 0, gf: 0 };
  for (const m of matches) {
    if (m.round !== 'group' || m.state !== 'post') continue;
    if (!set.has(m.home.id) || !set.has(m.away.id)) continue;
    const hs = m.home.score, as = m.away.score;
    if (hs == null || as == null) continue;
    rec[m.home.id].gf += hs; rec[m.home.id].gd += hs - as;
    rec[m.away.id].gf += as; rec[m.away.id].gd += as - hs;
    if (hs > as) rec[m.home.id].pts += 3; else if (hs < as) rec[m.away.id].pts += 3;
    else { rec[m.home.id].pts += 1; rec[m.away.id].pts += 1; }
  }
  return rec;
}

// Rank a group's teams using the FIFA 2026 order: points → head-to-head
// (points, GD, goals among teams level on points) → overall GD → overall goals.
// (Disciplinary + FIFA-ranking tiebreakers aren't in the feed; name breaks any
// remaining tie deterministically.)
function rankGroupOrder(ids, stat, matches) {
  const arr = [...ids].sort((a, b) => stat[b].pts - stat[a].pts);
  const ordered = [];
  let i = 0;
  while (i < arr.length) {
    let j = i;
    while (j < arr.length && stat[arr[j]].pts === stat[arr[i]].pts) j++;
    const block = arr.slice(i, j);
    if (block.length > 1) {
      const h = h2hAmong(block, matches);
      block.sort((a, b) =>
        (h[b].pts - h[a].pts) || (h[b].gd - h[a].gd) || (h[b].gf - h[a].gf) ||
        (stat[b].gd - stat[a].gd) || (stat[b].gf - stat[a].gf) ||
        stat[a].name.localeCompare(stat[b].name));
    }
    ordered.push(...block);
    i = j;
  }
  return ordered;
}

// The set of team ids that can no longer finish in the top 2 of their group.
// Enumerates win/draw/loss for every remaining group fixture and, when teams end
// level on points, resolves by HEAD-TO-HEAD points (the 2026 rule), staying
// optimistic on the goal-based sub-tiebreakers so we never falsely eliminate.
function top2EliminatedSet(byId, matches) {
  const groupTeams = {}, groupGames = {};
  for (const t of byId.values()) (groupTeams[t.group] ||= []).push(t.id);
  for (const m of matches) {
    if (m.round !== 'group') continue;
    if (!byId.has(m.home.id) || !byId.has(m.away.id)) continue;
    (groupGames[byId.get(m.home.id).group] ||= []).push(m);
  }
  const done = (m) => m.state === 'post' && m.home.score != null && m.away.score != null;
  const out = new Set();
  for (const g in groupTeams) {
    const ids = groupTeams[g], games = groupGames[g] || [];
    const played = games.filter(done), remaining = games.filter((m) => !done(m));
    const base = {}; for (const id of ids) base[id] = 0;
    for (const m of played) {
      const hs = m.home.score, as = m.away.score;
      if (hs > as) base[m.home.id] += 3; else if (hs < as) base[m.away.id] += 3;
      else { base[m.home.id] += 1; base[m.away.id] += 1; }
    }
    const R = remaining.length, combos = 3 ** R;
    for (const id of ids) {
      let canTop2 = false;
      for (let mask = 0; mask < combos && !canTop2; mask++) {
        const pts = { ...base }, res = [];
        let mm = mask;
        for (let i = 0; i < R; i++) {
          const o = mm % 3; mm = (mm - o) / 3; const m = remaining[i];
          res.push([m.home.id, m.away.id, o]);
          if (o === 0) pts[m.home.id] += 3; else if (o === 1) { pts[m.home.id] += 1; pts[m.away.id] += 1; } else pts[m.away.id] += 3;
        }
        let above = ids.filter((x) => x !== id && pts[x] > pts[id]).length;
        const tied = ids.filter((x) => pts[x] === pts[id]);
        if (tied.length > 1) {
          const set = new Set(tied), h = {};
          for (const x of tied) h[x] = 0;
          for (const m of played) {
            if (!set.has(m.home.id) || !set.has(m.away.id)) continue;
            const hs = m.home.score, as = m.away.score;
            if (hs > as) h[m.home.id] += 3; else if (hs < as) h[m.away.id] += 3; else { h[m.home.id] += 1; h[m.away.id] += 1; }
          }
          for (const [hId, aId, o] of res) {
            if (!set.has(hId) || !set.has(aId)) continue;
            if (o === 0) h[hId] += 3; else if (o === 1) { h[hId] += 1; h[aId] += 1; } else h[aId] += 3;
          }
          above += tied.filter((x) => x !== id && h[x] > h[id]).length;
        }
        if (above <= 1) canTop2 = true;
      }
      if (!canTop2) out.add(id);
    }
  }
  return out;
}

// Per-grouping flop: an out/eliminated team with the worst points-per-game.
function pickFlop(mine) {
  const out = mine.filter((t) => isOut(t.status) && t.played > 0);
  if (!out.length) return null;
  return out.sort((a, b) => (a.total / a.played) - (b.total / b.played) || a.gd - b.gd)[0];
}

// Tournament flop: the out/eliminated team that scored fewest points for games played.
function overallFlop(teams) {
  const out = teams.filter((t) => isOut(t.status) && t.played > 0);
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
