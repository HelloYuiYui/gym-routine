// Workout view: pick a session, see last time and the rest time, log one entry per exercise.
//
// app.js re-renders the whole view after every store change, so this view keeps its
// cards alive between renders (keyed by person, date and exercise) and patches them.
// Numbers typed but not saved, focus and the open keyboard survive a save elsewhere.
import { state, saveEntry, savePerson } from '../store.js';
import {
  visibleExercises, targetFor, todayEntry, lastEntry, formatEntry,
  validateEntry, shouldOfferWeekFlip, localDate,
} from '../logic.js';
import { startTimer } from '../timer.js';

const FIELDS = {
  weight: [
    { name: 'weight', label: 'kg', mode: 'decimal' },
    { name: 'sets', label: 'sets', mode: 'numeric' },
    { name: 'reps', label: 'reps', mode: 'numeric' },
  ],
  timed: [
    { name: 'sets', label: 'sets', mode: 'numeric' },
    { name: 'seconds', label: 'seconds', mode: 'numeric' },
    { name: 'weight', label: 'kg (optional)', mode: 'decimal' },
  ],
};
const TIMES_UP_MS = 5000;

let view = null;          // { container, personId } from the last render
let headerSlot = null;    // #week-slot from the last renderHeader
const root = el('div', 'workout');
const cards = new Map();  // `${personId}|${date}|${exerciseId}|${kind}` -> card
const blocks = new Map(); // banner, messages and info lists, refilled each render
const weekStampPending = new Set();
let timer = null;         // { exerciseId, remaining, cancel }
let timesUpId = null;     // exercise whose rest just ended, shown for a few seconds
let timesUpTimeout = null; // clears timesUpId after TIMES_UP_MS

// ---- Helpers ----

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className, text, onClick) {
  const b = el('button', className, text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

// The local date, read fresh every time: the page may stay open past midnight.
const today = () => localDate(new Date());
const findPerson = id => state.people.find(p => p.id === id);
const weekOf = person => (person.current_week === 'B' ? 'B' : 'A');
const otherWeek = week => (week === 'A' ? 'B' : 'A');

function clock(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function shortDate(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const opts = { day: 'numeric', month: 'short' };
  if (y !== new Date().getFullYear()) opts.year = 'numeric';
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', opts);
}

function personSessions(personId) {
  return state.sessions
    .filter(s => s.person_id === personId && !s.archived)
    .sort((a, b) => a.position - b.position);
}

// ---- Remembered session (per person, today only) ----

const sessionKey = personId => `gym.session.${personId}`;

function chosenSessionId(personId) {
  try {
    const saved = JSON.parse(localStorage.getItem(sessionKey(personId)));
    return saved && saved.date === today() ? saved.id : null;
  } catch {
    return null;
  }
}

function chooseSession(personId, sessionId) {
  try {
    localStorage.setItem(sessionKey(personId), JSON.stringify({ id: sessionId, date: today() }));
  } catch {
    // storage blocked: the choice simply is not remembered
  }
  refresh();
  window.scrollTo(0, 0);
}

function refresh() {
  if (!view) return;
  if (headerSlot) renderHeader(headerSlot, { personId: view.personId });
  render(view.container, view);
}

// ---- Week ----

function setWeek(person, week) {
  savePerson({ ...person, current_week: week, week_set_on: today() });
}

// ---- Header: session buttons and week toggle ----

export function renderHeader(slot, { personId }) {
  headerSlot = slot;
  const person = findPerson(personId);
  if (!person) {
    slot.replaceChildren();
    return;
  }
  const chosen = chosenSessionId(personId);
  const seg = el('div', 'segmented session-seg');
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', 'Session');
  for (const s of personSessions(personId)) {
    const b = button('seg', s.name, () => chooseSession(personId, s.id));
    b.setAttribute('aria-pressed', String(s.id === chosen));
    seg.append(b);
  }
  const week = weekOf(person);
  const toggle = button('btn week-btn', '', () => setWeek(person, otherWeek(week)));
  toggle.append(el('span', 'week-btn-label', 'Week'), el('span', 'week-btn-value', week));
  toggle.setAttribute('aria-label', `Week ${week}. Tap to switch to week ${otherWeek(week)}.`);
  const bar = el('div', 'workout-bar');
  bar.append(seg, toggle);
  slot.replaceChildren(bar);
}

// ---- Blocks rebuilt on every render (no inputs inside) ----

function block(key, className) {
  let node = blocks.get(key);
  if (!node) {
    node = el('div', className);
    blocks.set(key, node);
  }
  return node;
}

function weekBanner(person) {
  const next = otherWeek(weekOf(person));
  const node = block('banner', 'week-banner');
  node.setAttribute('role', 'status');
  const actions = el('div', 'week-banner-actions');
  actions.append(
    button('btn btn-primary', 'Yes', () => setWeek(person, next)),
    button('btn', 'Keep', () => setWeek(person, weekOf(person))),
  );
  node.replaceChildren(el('p', 'week-banner-text', `New week — switch to Week ${next}?`), actions);
  return node;
}

function message(text) {
  const node = block('message', 'workout-empty');
  node.replaceChildren(el('p', '', text));
  return node;
}

function sessionChooser(person, sessions) {
  const node = block('chooser', 'workout-empty');
  const list = el('div', 'choice-list');
  for (const s of sessions) {
    list.append(button('btn btn-choice btn-block', s.name, () => chooseSession(person.id, s.id)));
  }
  node.replaceChildren(el('p', 'workout-empty-title', 'Which session today?'), list);
  return node;
}

function infoList(items, week) {
  const node = block(`info:${items[0].id}`, 'info-list');
  node.replaceChildren(...items.map(ex => {
    const row = el('div', 'info-item');
    const line = el('p', 'info-line');
    line.append(el('span', 'info-name', ex.name));
    const target = targetFor(ex, week);
    if (target) line.append(' ', el('span', 'info-target', target));
    row.append(line);
    if (ex.notes) row.append(el('p', 'info-notes', ex.notes));
    return row;
  }));
  return node;
}

// ---- Exercise card (kept alive across renders) ----

function prefillValues(entry) {
  if (!entry) return { weight: '', sets: '', reps: '', seconds: '' };
  const str = v => (v === null || v === undefined ? '' : String(Number(v)));
  return { weight: str(entry.weight_kg), sets: str(entry.sets), reps: str(entry.reps), seconds: str(entry.seconds) };
}

function createCard(exercise, personId, date) {
  const card = { exercise, dirty: false, inputs: {} };
  const node = el('article', 'card workout-card');

  const head = el('div', 'wc-head');
  const titleWrap = el('div', 'wc-title-wrap');
  const title = el('h2', 'card-title wc-title');
  const doneTag = el('span', 'wc-done-tag', 'Logged');
  titleWrap.append(title, doneTag);
  const restBtn = button('btn rest-btn', '', () => toggleTimer(card.exercise));
  head.append(titleWrap, restBtn);

  const target = el('p', 'wc-target num');
  const notes = el('p', 'wc-notes');
  const last = el('p', 'wc-last');

  const fields = el('div', 'wc-fields');
  for (const f of FIELDS[exercise.kind]) {
    const label = el('label', 'field wc-field');
    const input = el('input', 'input input-num');
    input.type = 'text';
    input.inputMode = f.mode;
    if (f.mode === 'numeric') input.pattern = '[0-9]*';
    input.autocomplete = 'off';
    input.name = f.name;
    input.addEventListener('input', () => {
      card.dirty = true;
      input.removeAttribute('aria-invalid');
    });
    label.append(input, el('span', 'field-label', f.label));
    fields.append(label);
    card.inputs[f.name] = input;
  }

  const results = el('div', 'result-row');
  const held = button('result-btn result-held', '✓ Held', () => logResult(card, personId, 'held'));
  const failed = button('result-btn result-failed', '✗ Failed', () => logResult(card, personId, 'failed'));
  results.append(held, failed);

  node.append(head, target, notes, last, fields, results);
  Object.assign(card, { node, title, restBtn, target, notes, last, held, failed, date });

  const values = prefillValues(todayEntry(state.entries, exercise.id, date) ??
    lastEntry(state.entries, exercise, date, weekOf(findPerson(personId))));
  for (const [name, input] of Object.entries(card.inputs)) input.value = values[name];
  return card;
}

function updateCard(card, exercise, week) {
  card.exercise = exercise;
  const { date } = card;
  card.title.textContent = exercise.name;
  card.target.textContent = targetFor(exercise, week);
  card.target.hidden = !card.target.textContent;
  card.notes.textContent = exercise.notes || '';
  card.notes.hidden = !exercise.notes;

  const previous = lastEntry(state.entries, exercise, date, week);
  if (previous) {
    const ok = previous.result === 'held';
    card.last.replaceChildren(
      el('span', 'wc-last-label', 'last: '),
      el('span', 'num', formatEntry(previous, exercise.kind)),
      ' ',
      el('span', ok ? 'wc-held' : 'wc-failed', ok ? '✓ held' : '✗ failed'),
      el('span', 'wc-last-date', ` (${shortDate(previous.date)})`),
    );
  } else {
    card.last.replaceChildren(el('span', 'wc-last-label', 'no entry yet'));
  }

  const entry = todayEntry(state.entries, exercise.id, date);
  if (!card.dirty) {
    const values = prefillValues(entry ?? previous);
    for (const [name, input] of Object.entries(card.inputs)) {
      if (input.value !== values[name]) input.value = values[name];
    }
  }
  if (entry) card.node.dataset.done = entry.result;
  else delete card.node.dataset.done;
  card.held.setAttribute('aria-pressed', String(entry?.result === 'held'));
  card.failed.setAttribute('aria-pressed', String(entry?.result === 'failed'));
  paintRest(card);
}

function logResult(card, personId, result) {
  const person = findPerson(personId);
  if (!person) return;
  const raw = {};
  for (const [name, input] of Object.entries(card.inputs)) raw[name] = input.value;
  const check = validateEntry(card.exercise.kind, raw);
  for (const [name, input] of Object.entries(card.inputs)) {
    if (!check.ok && check.invalid.includes(name)) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }
  if (!check.ok) {
    card.inputs[check.invalid[0]].focus();
    return;
  }
  card.dirty = false;
  saveEntry({
    person_id: personId,
    exercise_id: card.exercise.id,
    date: today(),
    week: weekOf(person),
    ...check.values,
    result,
  });
}

// ---- Rest timer ----

function paintRest(card) {
  const { restBtn, exercise } = card;
  const rest = exercise.rest_seconds;
  restBtn.hidden = !rest;
  if (!rest) return;
  const running = timer?.exerciseId === exercise.id;
  const timesUp = !running && timesUpId === exercise.id;
  restBtn.dataset.state = running ? 'running' : timesUp ? 'done' : 'idle';
  if (running) {
    restBtn.replaceChildren(el('span', 'num rest-clock', clock(timer.remaining)), el('span', 'rest-action', 'Stop'));
    restBtn.setAttribute('aria-label', `Resting, ${clock(timer.remaining)} left. Tap to stop.`);
  } else {
    restBtn.replaceChildren(
      el('span', 'rest-label', timesUp ? 'rest over' : 'rest'),
      el('span', 'num rest-clock', clock(rest)),
      el('span', 'rest-play', '▶'),
    );
    restBtn.setAttribute('aria-label', `Start rest timer, ${clock(rest)}`);
  }
}

function paintRestFor(exerciseId) {
  for (const card of cards.values()) {
    if (card.exercise.id === exerciseId) paintRest(card);
  }
}

// Drop a "rest over" state (and its pending timeout), repainting the card that showed it.
function clearTimesUp() {
  clearTimeout(timesUpTimeout);
  timesUpTimeout = null;
  if (timesUpId === null) return;
  const id = timesUpId;
  timesUpId = null;
  paintRestFor(id);
}

function toggleTimer(exercise) {
  const previous = timer;
  clearTimesUp();
  if (previous) {
    previous.cancel();
    timer = null;
    paintRestFor(previous.exerciseId);
    if (previous.exerciseId === exercise.id) return;
  }
  const current = { exerciseId: exercise.id, remaining: exercise.rest_seconds, cancel: () => {} };
  timer = current;
  current.cancel = startTimer(
    exercise.rest_seconds,
    remaining => {
      current.remaining = remaining;
      if (timer === current) paintRestFor(exercise.id);
    },
    () => {
      if (timer !== current) return;
      timer = null;
      clearTimesUp();
      timesUpId = exercise.id;
      paintRestFor(exercise.id);
      timesUpTimeout = setTimeout(clearTimesUp, TIMES_UP_MS);
    },
  );
}

// ---- Render ----

function exerciseNodes(personId, date, exercises, week) {
  const nodes = [];
  let infoRun = [];
  const flushInfo = () => {
    if (infoRun.length) nodes.push(infoList(infoRun, week));
    infoRun = [];
  };
  for (const ex of exercises) {
    if (ex.kind === 'info' || !FIELDS[ex.kind]) {
      infoRun.push(ex);
      continue;
    }
    flushInfo();
    const key = `${personId}|${date}|${ex.id}|${ex.kind}`;
    let card = cards.get(key);
    if (!card) {
      card = createCard(ex, personId, date);
      cards.set(key, card);
    }
    updateCard(card, ex, week);
    nodes.push(card.node);
  }
  flushInfo();
  return nodes;
}

export function render(container, { personId }) {
  view = { container, personId };
  const person = findPerson(personId);
  const date = today();
  for (const key of cards.keys()) {
    if (key.split('|')[1] !== date) cards.delete(key); // yesterday's drafts are stale
  }

  const nodes = [];
  if (person) {
    if (!person.week_set_on && !weekStampPending.has(person.id)) {
      weekStampPending.add(person.id);
      queueMicrotask(() => {
        const fresh = findPerson(person.id);
        if (fresh && !fresh.week_set_on) savePerson({ ...fresh, week_set_on: today() });
        weekStampPending.delete(person.id);
      });
    }
    if (shouldOfferWeekFlip(person.week_set_on, date)) nodes.push(weekBanner(person));

    const week = weekOf(person);
    const sessions = personSessions(personId);
    const sessionId = chosenSessionId(personId);
    const session = sessions.find(s => s.id === sessionId);
    if (!sessions.length) {
      nodes.push(message('No sessions yet. Add one in Routine.'));
    } else if (!session) {
      nodes.push(sessionChooser(person, sessions));
    } else {
      const exercises = visibleExercises(state.exercises.filter(e => e.session_id === session.id), week);
      if (exercises.length) nodes.push(...exerciseNodes(personId, date, exercises, week));
      else nodes.push(message(`Nothing to do in ${session.name} for Week ${week}. Add exercises in Routine.`));
    }
  }

  // Only touch the DOM order when it changed, so a focused input is never detached.
  const current = [...root.children];
  if (current.length !== nodes.length || current.some((n, i) => n !== nodes[i])) {
    root.replaceChildren(...nodes);
  }
  if (container.firstChild !== root || container.childNodes.length !== 1) container.replaceChildren(root);
}
