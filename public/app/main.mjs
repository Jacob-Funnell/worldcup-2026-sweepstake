// ─────────────────────────────────────────────────────────────────────────────
//  Entry point. Loads data (live ESPN first, this-morning's snapshot as backup),
//  computes with the shared engine, and paints the page.
// ─────────────────────────────────────────────────────────────────────────────
import { fetchTournament } from './data-source.mjs';
import { compute } from './compute.mjs';
import { PEOPLE, SNAPSHOT } from './config.mjs';
import * as UI from './ui.mjs';

const $ = (s) => document.querySelector(s);
const app = $('#app');

function decorate(p) {
  // Attach person meta (colour/emoji/img) onto the computed groupings.
  const tag = (g) => Object.assign(g, PEOPLE[g.key]);
  p.leaderboard.forEach(tag); p.goldenBoot.forEach(tag); p.groupings.forEach(tag);
  return p;
}

async function tryFetch(url) {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}
// Prefer the daily-pushed remote snapshot (fresh movement); fall back to the
// copy bundled into this deploy.
async function loadBaked() {
  return (await tryFetch(`${SNAPSHOT.remote}?t=${Date.now()}`)) || (await tryFetch(`${SNAPSHOT.local}?t=${Date.now()}`));
}

async function loadLive() {
  const { matches, fetchedAt } = await fetchTournament();
  if (!matches.length) throw new Error('empty feed');
  const p = compute(matches);
  p.fetchedAt = fetchedAt;
  return p;
}

function setStatus(state, text) {
  const el = $('#live');
  el.className = 'live ' + state;
  el.querySelector('.live__txt').textContent = text;
}

function timeAgo(iso) {
  if (!iso) return '';
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  return h < 24 ? `${h}h ago` : new Date(iso).toLocaleDateString('en-GB');
}

function paint(p) {
  decorate(p);
  app.innerHTML = `
    ${UI.renderPrizes(p)}

    <section>
      <div class="section-head"><h2>🏆 The £10 race</h2><span class="hint">3 pts a win · 1 a draw · + round bonuses</span></div>
      ${UI.renderBoard(p)}
    </section>

    <section>
      <div class="section-head"><h2>🌅 Overnight movers</h2><span class="hint">what changed since yesterday morning</span></div>
      ${UI.renderMovers(p)}
    </section>

    <section>
      <div class="section-head"><h2>📊 Tournament watch</h2></div>
      ${UI.renderStats(p)}
    </section>

    <section>
      <div class="section-head"><h2>👥 The squads</h2><span class="hint">16 teams each · tap a name</span></div>
      ${UI.renderTabs(p)}
      <div id="squads">${p.leaderboard.slice().sort((a,b)=>a.rank-b.rank).map(UI.renderSquad).join('')}</div>
    </section>

    <section>
      <div class="section-head"><h2>🗺️ Group by group</h2><span class="hint">coloured dot = who owns the team</span></div>
      ${UI.renderGroups(p)}
    </section>

    <section>
      <div class="section-head"><h2>📋 How it's scored</h2></div>
      <div class="card rules">
        <ul>
          <li><span class="chip">Match</span><span><b>3 pts</b> for a win, <b>1</b> for a draw — every game your team plays, group and knockout.</span></li>
          <li><span class="chip">Bonus</span><span>Reaching a round banks extra: <b>R32 +3</b>, <b>R16 +5</b>, <b>QF +8</b>, <b>SF +12</b>, <b>Final +16</b>, <b>Champions +25</b>.</span></li>
          <li><span class="chip">🏆 £10</span><span>Most total points across your 16 teams wins. Tie-break: goal difference, then goals.</span></li>
          <li><span class="chip">🍺 Boot</span><span>Most goals scored by your teams wins a drink — a separate race, so it can go to someone else.</span></li>
        </ul>
      </div>
    </section>`;
  wireTabs();
}

function wireTabs() {
  const tabs = [...document.querySelectorAll('.tab')];
  const squads = [...document.querySelectorAll('[data-squad]')];
  const show = (k) => {
    tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.k === k)));
    squads.forEach((s) => { s.style.display = s.dataset.squad === k ? '' : 'none'; });
  };
  tabs.forEach((t) => t.addEventListener('click', () => show(t.dataset.k)));
  if (tabs[0]) show(tabs[0].dataset.k);
}

async function init() {
  app.innerHTML = `<div class="skel">⚽ Kicking off… loading the latest scores</div>`;
  const baked = await loadBaked();
  try {
    const live = await loadLive();
    // graft the overnight movement + date context from the baked snapshot
    if (baked) { live.movement = baked.movement; live.dateLondon = baked.dateLondon; }
    paint(live);
    setStatus('', `Live · scores ${timeAgo(live.fetchedAt)}`);
  } catch (e) {
    if (baked) {
      paint(baked);
      setStatus('stale', `Showing this morning's snapshot · live feed unreachable`);
    } else {
      app.innerHTML = `<div class="skel">😬 Couldn't reach the score feed right now. Try a refresh in a minute.</div>`;
      setStatus('error', 'Offline');
    }
  }
}

init();
