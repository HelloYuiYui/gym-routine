// Progress view: one small line chart per logged exercise for the selected person.
// Weight lifts chart kg, timed holds chart seconds. Held points are filled, failed are hollow.
// Entries are charted by their own shape, so an exercise whose kind changed (or that is
// now 'info') still shows the history that matches.
import { state } from '../store.js';
import { chartSeries, chartPoints, seriesKind } from '../logic.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const W = 320;        // viewBox width; the SVG scales to the card
const H = 120;
const LABEL_W = 44;   // room on the left for the min / max value labels
const PAD = 16;
const HIT = 22;       // hit-target radius in viewBox units (44px across at card width)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

let view = null;                 // { container, personId } from the last render
const selected = new Map();      // exerciseId -> `${date}|${label}|${result}` of the tapped point

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function svg(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

// '2026-11-08' -> '8 Nov' (no Date object: no timezone off-by-one).
function shortDate(ymd) {
  const [, m, d] = ymd.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

const fmt = n => String(Number(n));
const pointKey = p => `${p.date}|${p.label}|${p.result}`;

// ---- Chart ----

function buildChart(exercise, series) {
  const plotW = W - LABEL_W;
  const points = chartPoints(series, plotW, H, PAD).map(p => ({ x: p.x + LABEL_W, y: p.y }));
  const chosen = selected.get(exercise.id);
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'pg-svg', role: 'group' });
  root.setAttribute('aria-label', `${exercise.name}, ${series.length} entries`);

  // Baseline and the two value labels sit on the lowest and highest points.
  root.append(svg('line', { class: 'pg-base', x1: LABEL_W, x2: W, y1: H - 2, y2: H - 2 }));
  const values = series.map(p => p.value);
  const lo = Math.min(...values), hi = Math.max(...values);
  const labelAt = (value, y) => {
    const t = svg('text', { class: 'pg-axis', x: LABEL_W - 6, y: y + 4, 'text-anchor': 'end' });
    t.textContent = fmt(value);
    root.append(t);
  };
  const yOf = value => points[values.indexOf(value)].y;
  labelAt(hi, yOf(hi));
  if (hi !== lo) labelAt(lo, yOf(lo));

  if (points.length > 1) {
    root.append(svg('polyline', {
      class: 'pg-line',
      points: points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '),
    }));
  }

  let gap = Infinity;
  for (let i = 1; i < points.length; i++) gap = Math.min(gap, points[i].x - points[i - 1].x);
  const hitR = Math.max(8, Math.min(HIT, gap / 2));

  series.forEach((pt, i) => {
    const { x, y } = points[i];
    const isSel = pointKey(pt) === chosen;
    if (isSel) root.append(svg('circle', { class: 'pg-ring', cx: x, cy: y, r: 10 }));
    root.append(svg('circle', { class: `pg-dot pg-dot-${pt.result}`, cx: x, cy: y, r: 6 }));
  });
  series.forEach((pt, i) => {
    const hit = svg('circle', {
      class: 'pg-hit', cx: points[i].x, cy: points[i].y, r: hitR,
      tabindex: 0, role: 'button',
      'aria-label': `${shortDate(pt.date)}, ${pt.label}, ${pt.result}`,
    });
    const title = svg('title');
    title.textContent = `${shortDate(pt.date)} — ${pt.label} — ${pt.result}`;
    hit.append(title);
    const choose = () => {
      selected.set(exercise.id, pointKey(pt));
      if (view) render(view.container, view);
    };
    hit.addEventListener('click', choose);
    hit.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        choose();
      }
    });
    root.append(hit);
  });
  return root;
}

function detailLine(series, chosen) {
  const pt = series.find(p => pointKey(p) === chosen);
  const line = el('p', 'pg-detail');
  line.setAttribute('aria-live', 'polite');
  if (!pt) {
    line.classList.add('muted');
    line.textContent = 'Tap a point for details';
    return line;
  }
  line.append(
    `${shortDate(pt.date)} — `,
    el('span', 'num', pt.label),
    ' — ',
    el('span', pt.result === 'held' ? 'pg-held' : 'pg-failed', pt.result),
  );
  return line;
}

// ---- Card ----

function buildCard(exercise, series, kind, removed) {
  const unit = kind === 'timed' ? 's' : 'kg';
  const latest = series[series.length - 1];
  const card = el('article', 'card pg-card');

  const head = el('div', 'pg-head');
  const titleWrap = el('div', 'pg-title-wrap');
  titleWrap.append(el('h3', 'card-title', exercise.name));
  if (removed) titleWrap.append(el('span', 'pg-removed', 'removed'));
  const latestBox = el('p', 'pg-latest');
  latestBox.append(el('span', 'num pg-latest-value', fmt(latest.value)), el('span', 'pg-unit', ` ${unit}`));
  head.append(titleWrap, latestBox);

  const dates = el('div', 'pg-dates muted');
  dates.append(el('span', '', shortDate(series[0].date)));
  if (series.length > 1) dates.append(el('span', '', shortDate(latest.date)));

  card.append(head, buildChart(exercise, series), dates, detailLine(series, selected.get(exercise.id)));
  return card;
}

// ---- Render ----

export function render(container, { personId }) {
  view = { container, personId };
  const sessions = state.sessions
    .filter(s => s.person_id === personId)
    .sort((a, b) => (a.archived - b.archived) || (a.position - b.position));

  const groups = [];
  for (const session of sessions) {
    const cards = [];
    const exercises = state.exercises
      .filter(e => e.session_id === session.id)
      .sort((a, b) => a.position - b.position);
    for (const ex of exercises) {
      const mine = state.entries.filter(e => e.person_id === personId && e.exercise_id === ex.id);
      const series = chartSeries(mine, ex);
      if (!series.length) continue;
      cards.push(buildCard(ex, series, seriesKind(mine, ex), ex.archived || session.archived));
    }
    if (cards.length) {
      const group = el('section', 'pg-group');
      group.append(el('h2', 'pg-session', session.name), ...cards);
      groups.push(group);
    }
  }

  const root = el('div', 'progress');
  if (!groups.length) {
    root.append(el('p', 'placeholder', 'Nothing logged yet. Entries you save on the Workout tab will show up here.'));
  } else {
    root.append(...groups);
  }
  container.replaceChildren(root);
}
