// ─────────────────────────────────────────────────────────────────────────────
//  Leaders-over-time line chart. Hand-rolled SVG (no library) so it stays
//  self-contained and renders identically everywhere. Two modes: the £10 points
//  race and the 🍺 Golden Boot goals race, swapped by the toggle.
// ─────────────────────────────────────────────────────────────────────────────
import { PEOPLE, PEOPLE_ORDER, PRIZES } from './config.mjs';

const W = 720, H = 340;
const PAD = { l: 40, r: 58, t: 16, b: 34 };

const MODES = {
  points: { key: 'points', label: `🏆 The £10`, unit: 'pts' },
  goals:  { key: 'goals',  label: `🍺 Golden Boot`, unit: 'goals' },
};

const fmtDay = (d) => {
  const dt = new Date(d + 'T12:00:00Z');
  return `${dt.getUTCDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][dt.getUTCMonth()]}`;
};
// Round the axis top to a multiple of 4 so all four gridline labels are integers.
const niceMax = (v) => Math.max(4, Math.ceil(v / 4) * 4);

// The toggle + a holder the chart paints into. Wired up in main.mjs.
export function trendSection(seriesData) {
  const have = seriesData && seriesData.days && seriesData.days.length;
  return `<div class="card trend">
    <div class="trend__bar">
      <div class="trend__toggle" role="tablist">
        <button class="trend__btn" data-mode="points" role="tab" aria-selected="true">${MODES.points.label}</button>
        <button class="trend__btn" data-mode="goals" role="tab" aria-selected="false">${MODES.goals.label}</button>
      </div>
    </div>
    <div id="trend-svg">${have ? trendSVG(seriesData, 'points') : noData()}</div>
  </div>`;
}

function noData() {
  return `<div class="trend__empty">📈 The trend line draws itself as match-days roll in.</div>`;
}

export function trendSVG(seriesData, mode = 'points') {
  const { days, series } = seriesData;
  const m = MODES[mode] || MODES.points;
  const n = days.length;
  const xOf = (i) => n <= 1 ? (PAD.l + (W - PAD.l - PAD.r) / 2) : PAD.l + i * (W - PAD.l - PAD.r) / (n - 1);
  let max = 0;
  for (const k of PEOPLE_ORDER) for (const v of (series[k]?.[m.key] || [])) max = Math.max(max, v);
  const top = niceMax(max);
  const yOf = (v) => (H - PAD.b) - (v / top) * (H - PAD.t - PAD.b);

  // gridlines + y labels
  let grid = '';
  for (let g = 0; g <= 4; g++) {
    const val = (top / 4) * g, y = yOf(val);
    grid += `<line class="grid" x1="${PAD.l}" y1="${y.toFixed(1)}" x2="${W - PAD.r}" y2="${y.toFixed(1)}"/>`;
    grid += `<text class="ylab" x="${PAD.l - 8}" y="${(y + 3.5).toFixed(1)}" text-anchor="end">${Math.round(val)}</text>`;
  }

  // x labels (thin to ~7, always first + last)
  let xlabs = '';
  const stepEvery = Math.max(1, Math.ceil(n / 7));
  days.forEach((d, i) => {
    if (i !== 0 && i !== n - 1 && i % stepEvery !== 0) return;
    xlabs += `<text class="xlab" x="${xOf(i).toFixed(1)}" y="${H - PAD.b + 18}" text-anchor="middle">${fmtDay(d)}</text>`;
  });

  // one line per person; collect end labels for collision nudging
  let lines = '', ends = [];
  PEOPLE_ORDER.forEach((k) => {
    const p = PEOPLE[k];
    const data = series[k]?.[m.key] || [];
    if (!data.length) return;
    const pts = data.map((v, i) => [xOf(i), yOf(v)]);
    const d = pts.map((pt, i) => `${i ? 'L' : 'M'}${pt[0].toFixed(1)} ${pt[1].toFixed(1)}`).join(' ');
    const dots = pts.map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.4" fill="${p.colour}" stroke="#fff" stroke-width="1.5"/>`).join('');
    lines += `<path class="line" d="${d}" fill="none" stroke="${p.colour}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>${dots}`;
    const last = pts[pts.length - 1];
    ends.push({ y: last[1], x: last[0], colour: p.colour, emoji: p.emoji, val: data[data.length - 1] });
  });
  // nudge end labels so they don't overlap
  ends.sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 16) ends[i].y = ends[i - 1].y + 16;
  const endLabels = ends.map((e) =>
    `<text class="endlab" x="${(W - PAD.r + 8)}" y="${(e.y + 4).toFixed(1)}" fill="${e.colour}">${e.emoji}${e.val}</text>`
  ).join('');

  return `<svg viewBox="0 0 ${W} ${H}" class="trend__svg" role="img" aria-label="${m.label} over time">
    ${grid}${xlabs}${lines}${endLabels}
  </svg>`;
}
