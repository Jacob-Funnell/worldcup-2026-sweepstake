// ─────────────────────────────────────────────────────────────────────────────
//  Rendering. Pure string builders → injected into the page. No framework.
// ─────────────────────────────────────────────────────────────────────────────
import { PRIZES, ROUND_META } from './config.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ord = (n) => ['🥇', '🥈', '🥉'][n - 1] || `${n}th`;

function avatar(g, big = false) {
  const img = g.img ? `<img src="${esc(g.img)}" alt="" onerror="this.style.display='none'">` : '';
  return `<div class="avatar" aria-hidden="true" style="--c:${g.colour}">${img || g.emoji}</div>`;
}
function flag(url, cls = 'flag') {
  return url ? `<img class="${cls}" src="${esc(url)}" alt="" loading="lazy">` : `<span class="${cls}" style="background:#dfe3ee"></span>`;
}

/* ── Prizes ──────────────────────────────────────────────────────────────── */
export function renderPrizes(p) {
  const lead = p.leaderboard[0], boot = p.goldenBoot[0];
  const tied = p.leaderboard[1] && p.leaderboard[1].total === lead.total;
  return `<div class="prizes">
    <div class="prize">
      <div class="prize__emoji">${PRIZES.main.emoji}</div>
      <div class="prize__body">
        <div class="prize__title">${esc(PRIZES.main.title)} · leading</div>
        <div class="prize__leader"><span style="color:${lead.colour}">●</span> ${esc(lead.character)} <span style="color:var(--ink-3);font-weight:600">(${esc(lead.person)})</span>${tied ? ' <span class="pill">tied on pts</span>' : ''}</div>
        <div class="prize__blurb">${esc(PRIZES.main.blurb)}</div>
      </div>
    </div>
    <div class="prize">
      <div class="prize__emoji">${PRIZES.bonus.emoji}</div>
      <div class="prize__body">
        <div class="prize__title">${esc(PRIZES.bonus.title)} · leading</div>
        <div class="prize__leader"><span style="color:${boot.colour}">●</span> ${esc(boot.character)} <span style="color:var(--ink-3);font-weight:600">${boot.gf} goals</span></div>
        <div class="prize__blurb">${esc(PRIZES.bonus.blurb)}</div>
      </div>
    </div>
  </div>`;
}

/* ── Leaderboard ─────────────────────────────────────────────────────────── */
export function renderBoard(p) {
  const mv = p.movement?.groupings || {};
  const cards = p.leaderboard.map((g) => {
    const m = mv[g.key];
    let move = '<span class="move same">— no change yet</span>';
    if (m && p.movement.since) {
      if (m.rankDelta > 0) move = `<span class="move up">▲ up ${m.rankDelta} · +${m.pointsDelta} pts overnight</span>`;
      else if (m.rankDelta < 0) move = `<span class="move down">▼ down ${-m.rankDelta} · +${m.pointsDelta} pts overnight</span>`;
      else move = `<span class="move same">— held ${ord(g.rank)} · +${m.pointsDelta} pts overnight</span>`;
    }
    return `<div class="gcard rank${g.rank}" style="--c:${g.colour}">
      ${avatar(g)}
      <div class="gcard__id">
        <div class="gcard__char">${esc(g.character)}</div>
        <div class="gcard__person">aka <b>${esc(g.person)}</b></div>
        <div class="gcard__meta">
          <span class="pill">W${g.wins}–D${g.draws}–L${g.losses}</span>
          <span class="pill ${g.gd >= 0 ? 'good' : 'bad'}">GD ${g.gd >= 0 ? '+' : ''}${g.gd}</span>
          <span class="pill">⚽ ${g.gf}</span>
          <span class="pill">${g.alive} alive</span>
        </div>
      </div>
      <div class="gcard__score">
        <div class="gcard__pts">${g.total}</div>
        <div class="gcard__ptslabel">points</div>
        ${move}
      </div>
    </div>`;
  }).join('');
  return `<div class="board">${cards}</div>`;
}

/* ── Overnight movers ────────────────────────────────────────────────────── */
export function renderMovers(p) {
  const mvt = p.movement;
  if (!mvt || !mvt.since) {
    return `<div class="card movers"><div class="movers__empty">📸 No overnight movement to show yet — it lands here after the next morning snapshot. (Live scores above are always current.)</div></div>`;
  }
  const rows = (mvt.teamDeltas || []).map((t) => {
    const col = colourFor(p, t.owner);
    return `<div class="delta-row">
      <span class="own" style="background:${col}"></span>
      ${flag(t.flag)}
      <span class="nm">${esc(t.name)}</span>
      <span class="d">+${t.totalDelta} pts${t.gfDelta ? ` · +${t.gfDelta}⚽` : ''}</span>
    </div>`;
  }).join('');
  const mover = mvt.topMover ? p.leaderboard.find((g) => g.key === mvt.topMover) : null;
  const head = mover
    ? `<div class="prize__title">Overnight ${esc(mvt.since)} → ${esc(p.dateLondon || 'today')}</div>
       <div style="font-weight:800;font-size:15px;margin:2px 0 10px">🚀 Biggest mover: <span style="color:${mover.colour}">${esc(mover.character)}</span> (${esc(mover.person)})</div>`
    : '';
  return `<div class="card movers">${head}
    ${rows ? `<div class="delta-list">${rows}</div>` : '<div class="movers__empty">Quiet night — no points changed hands.</div>'}
  </div>`;
}

/* ── Tournament watch stats ──────────────────────────────────────────────── */
export function renderStats(p) {
  const s = p.stats;
  const bp = s.bestPerformer, ts = s.topScorerTeam, fl = s.biggestFlop;
  const owLabel = (k) => { const g = p.leaderboard.find((x) => x.key === k); return g ? `${g.emoji} ${g.person}` : ''; };
  const card = (k, v, sub) => `<div class="stat"><div class="stat__k">${k}</div><div class="stat__v">${v}</div>${sub ? `<div class="stat__sub">${sub}</div>` : ''}</div>`;
  return `<div class="stats">
    ${card('⭐ Best team', bp ? `${flag(bp.flag)} ${esc(bp.name)}` : '—', bp ? `${bp.total} pts · ${esc(owLabel(bp.owner))}` : '')}
    ${card('🥅 Top scorers', ts ? `${flag(ts.flag)} ${esc(ts.name)}` : '—', ts ? `${ts.gf} goals · ${esc(owLabel(ts.owner))}` : '')}
    ${card('💩 Biggest flop', fl ? `${flag(fl.flag)} ${esc(fl.name)}` : 'None yet', fl ? `${fl.total} pts, out · ${esc(owLabel(fl.owner))}` : 'nobody’s out')}
    ${card('📅 Matches', `${s.matchesPlayed} <span style="color:var(--ink-3);font-weight:700;font-size:13px">/ ${s.matchesTotal}</span>`, `${s.matchesLive ? s.matchesLive + ' live · ' : ''}${s.matchesUpcoming} to play`)}
  </div>`;
}

/* ── Squads (per grouping) ───────────────────────────────────────────────── */
export function renderTabs(p) {
  return `<div class="tabs" role="tablist">` + p.leaderboard
    .slice().sort((a, b) => a.rank - b.rank)
    .map((g, i) => `<button class="tab" data-k="${g.key}" role="tab" aria-selected="${i === 0}">
      <span class="dot" style="background:${g.colour}"></span>${esc(g.person)}</button>`).join('') + `</div>`;
}
export function renderSquad(g) {
  const teams = g.teams.slice().sort((a, b) => b.total - a.total || b.gd - a.gd || b.gf - a.gf);
  const rows = teams.map((t) => {
    let tag = '<span class="tag alive">In</span>';
    if (t.champion) tag = '<span class="tag champion">🏆 Champs</span>';
    else if (t.status === 'out') tag = '<span class="tag out">Out</span>';
    const best = g.best && g.best.id === t.id ? '<span class="tag best">★ Top</span>' : '';
    const rec = t.played ? `${t.wins}W ${t.draws}D ${t.losses}L · ⚽${t.gf}-${t.ga}` : 'yet to play';
    const far = t.furthest !== 'group' ? ` · ${esc(ROUND_META[t.furthest]?.short || '')}` : '';
    return `<div class="team-row ${t.status === 'out' ? 'out' : ''}">
      ${flag(t.flag)}
      <div></div>
      <div class="team-row__nm">
        <div class="team-row__name">${esc(t.name)} <span class="grp">${esc(t.group)}</span> ${best} ${tag}</div>
        <div class="team-row__sub">${rec}${far}</div>
      </div>
      <div class="team-row__pts">${t.total}${t.bonusPoints ? `<small>+${t.bonusPoints} bonus</small>` : '<small>pts</small>'}</div>
    </div>`;
  }).join('');
  return `<div class="card squad" data-squad="${g.key}" style="--c:${g.colour}">
    <div class="squad-head">
      ${avatar(g)}
      <div>
        <div class="squad-head__big">${esc(g.character)}</div>
        <div class="gcard__person">aka <b style="color:${g.colour}">${esc(g.person)}</b> · ${ordinalRank(g.rank)} in the £10 race</div>
        <div class="squad-totals">
          <span><b>${g.total}</b> pts</span>
          <span><b>${g.gf}</b> goals</span>
          <span>GD <b>${g.gd >= 0 ? '+' : ''}${g.gd}</b></span>
          <span><b>${g.alive}</b> still in</span>
          ${g.flop ? `<span>💩 flop: <b>${esc(g.flop.name)}</b></span>` : ''}
        </div>
      </div>
    </div>
    ${rows}
  </div>`;
}

/* ── Group tables A–L ────────────────────────────────────────────────────── */
export function renderGroups(p) {
  const byGroup = {};
  for (const t of p.teams) (byGroup[t.group] ||= []).push(t);
  const letters = Object.keys(byGroup).sort();
  return `<div class="groups">` + letters.map((L) => {
    const teams = byGroup[L].slice().sort((a, b) =>
      b.matchPoints - a.matchPoints || b.gd - a.gd || b.gf - a.gf || a.name.localeCompare(b.name));
    const rows = teams.map((t, i) => {
      const col = colourFor(p, t.owner);
      return `<div class="grp-team ${i < 2 ? 'qual' : ''}">
        <span class="rk">${i + 1}</span>
        ${flag(t.flag)}
        <span class="nm"><span class="own" style="background:${col}" title="${esc(t.owner)}"></span>${esc(t.name)}</span>
        <span class="pts">${t.matchPoints}</span>
      </div>`;
    }).join('');
    return `<div class="card grp-card"><h3>Group ${esc(L)}</h3>${rows}</div>`;
  }).join('') + `</div>`;
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */
function colourFor(p, ownerKey) { return (p.leaderboard.find((g) => g.key === ownerKey) || {}).colour || '#888'; }
function ordinalRank(n) { return ['1st', '2nd', '3rd'][n - 1] || `${n}th`; }
