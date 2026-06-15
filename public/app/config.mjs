// ─────────────────────────────────────────────────────────────────────────────
//  Sweepstake config — everything you three might want to tweak lives here.
//  Change a number, push, and the site + the 8am task both pick it up.
// ─────────────────────────────────────────────────────────────────────────────

// The three groupings (Charlie Chalk character draw).
export const PEOPLE = {
  lewis:   { key: 'lewis',   character: 'Lewis T. Duck',     person: 'Jacob', colour: '#2f9e57', emoji: '🦆' },
  arnold:  { key: 'arnold',  character: 'Arnold the Elephant', person: 'Pete', colour: '#2f6fd0', emoji: '🐘' },
  mildred: { key: 'mildred', character: 'Captain Mildred',   person: 'Matt',  colour: '#d23b46', emoji: '🧭' },
};
export const PEOPLE_ORDER = ['lewis', 'arnold', 'mildred'];

// What's on the line.
export const PRIZES = {
  main:  { emoji: '🏆', title: 'The £10',        blurb: 'Overall winner takes £10 — a fiver each from the other two.' },
  bonus: { emoji: '🍺', title: 'The Golden Boot', blurb: 'Most goals scored across your 16 teams wins a drink.' },
};

// ── Scoring for the main £10 race ────────────────────────────────────────────
// Match points: every game a team plays (group AND knockout).
// Round bonuses: awarded once a team REACHES that stage (cumulative as they go deeper).
// A knockout decided on penalties counts as a draw for match points, but the
// team that goes through still banks the round bonus for the next stage.
export const SCORING = {
  matchPoints: { win: 3, draw: 1, loss: 0 },
  roundBonus: {            // reaching each stage is worth:
    r32: 3,                // made the Round of 32
    r16: 5,                // made the Round of 16
    qf: 8,                 // made the Quarter-finals
    sf: 12,                // made the Semi-finals
    final: 16,             // reached the Final
    champion: 25,          // won the whole thing
  },
};

// Pretty labels + ordering for tournament stages.
export const ROUND_META = {
  group:  { key: 'group',  label: 'Group stage', short: 'Group', order: 0 },
  r32:    { key: 'r32',    label: 'Round of 32', short: 'R32',   order: 1 },
  r16:    { key: 'r16',    label: 'Round of 16', short: 'R16',   order: 2 },
  qf:     { key: 'qf',     label: 'Quarter-final', short: 'QF',  order: 3 },
  sf:     { key: 'sf',     label: 'Semi-final',  short: 'SF',    order: 4 },
  third:  { key: 'third',  label: '3rd-place match', short: '3rd', order: 4 }, // consolation, no bonus
  final:  { key: 'final',  label: 'Final',       short: 'Final', order: 5 },
};

// Map ESPN calendar labels → our round keys (used to bin matches by stage).
export const ESPN_ROUND_LABELS = {
  'Group': 'group',
  'Round of 32': 'r32',
  'Rd of 16': 'r16',
  'Quarterfinals': 'qf',
  'Semifinals': 'sf',
  '3rd-Place Match': 'third',
  'Final': 'final',
};

// ESPN FIFA World Cup feed (no key, CORS-open).
export const ESPN = {
  scoreboard: 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard',
  // Whole tournament in one ranged query (11 Jun – 19 Jul 2026).
  range: '20260611-20260720',
  limit: 400,
};

// Where the daily "overnight" snapshot lives. The 8am task pushes a fresh
// latest.json to GitHub; the site reads it from raw (CORS-open) so movement
// updates without needing a redeploy. Falls back to the bundled local copy.
export const SNAPSHOT = {
  remote: 'https://raw.githubusercontent.com/Jacob-Funnell/worldcup-2026-sweepstake/main/public/data/latest.json',
  local: './data/latest.json',
};

export const TZ = 'Europe/London';
