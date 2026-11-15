// Pure logic: no DOM, window, localStorage or network access.

const pad2 = n => String(n).padStart(2, '0');

export function localDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function parseNumber(text) {
  const t = String(text ?? '').trim();
  if (!/^\d+(?:[.,]\d+)?$/.test(t)) return null;
  return Number(t.replace(',', '.'));
}

// Upper bounds keep absurd numbers (typos, int overflow) from ever reaching the server.
export const LIMITS = { weight: 9999, sets: 999, reps: 999, seconds: 86400 };

function parseInt1(text, max) {
  const n = parseNumber(text);
  return n !== null && Number.isInteger(n) && n >= 1 && n <= max ? n : null;
}

function parseWeight(text) {
  const n = parseNumber(text);
  return n !== null && n <= LIMITS.weight ? n : null;
}

export function validateEntry(kind, raw) {
  const invalid = [];
  const weight = parseWeight(raw.weight);
  const sets = parseInt1(raw.sets, LIMITS.sets);
  let reps = null, seconds = null;
  if (kind === 'weight') {
    if (weight === null) invalid.push('weight');
    if (sets === null) invalid.push('sets');
    reps = parseInt1(raw.reps, LIMITS.reps);
    if (reps === null) invalid.push('reps');
  } else {
    if (String(raw.weight ?? '').trim() !== '' && weight === null) invalid.push('weight');
    if (sets === null) invalid.push('sets');
    seconds = parseInt1(raw.seconds, LIMITS.seconds);
    if (seconds === null) invalid.push('seconds');
  }
  if (invalid.length) return { ok: false, invalid };
  return { ok: true, values: { weight_kg: weight, sets, reps, seconds } };
}

export function visibleExercises(exercises, week) {
  return exercises
    .filter(e => !e.archived && (e.week === 'both' || e.week === week))
    .sort((a, b) => a.position - b.position);
}

export function targetFor(exercise, week) {
  if (week === 'B' && exercise.target_b) return exercise.target_b;
  return exercise.target || '';
}

export function todayEntry(entries, exerciseId, date) {
  return entries.find(e => e.exercise_id === exerciseId && e.date === date);
}

// An entry's own shape: one with seconds is a timed hold, anything else a weight lift.
// Exercises can change kind after entries were logged, so entries are read by shape.
export function entryKind(entry) {
  return entry.seconds === null || entry.seconds === undefined ? 'weight' : 'timed';
}

const isLoggedKind = kind => kind === 'weight' || kind === 'timed';
const byDateAsc = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

// Only entries shaped like the exercise's current kind (any shape when the kind is not a logged one).
export function lastEntry(entries, exercise, date, week) {
  const kind = exercise.kind;
  const earlier = entries
    .filter(e => e.exercise_id === exercise.id && e.date < date)
    .filter(e => !isLoggedKind(kind) || entryKind(e) === kind)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  if (exercise.target_b) {
    const sameWeek = earlier.find(e => e.week === week);
    if (sameWeek) return sameWeek;
  }
  return earlier[0];
}

const num = n => String(Number(n));

// `kind` is kept for compatibility and ignored: the entry's own shape decides.
export function formatEntry(entry, kind) {
  if (entryKind(entry) === 'timed') {
    const base = `${entry.sets}×${entry.seconds}s`;
    return entry.weight_kg === null || entry.weight_kg === undefined
      ? base : `${num(entry.weight_kg)} kg ${entry.sets}×${entry.seconds}s`;
  }
  return `${num(entry.weight_kg)} kg ${entry.sets}×${entry.reps}`;
}

// Days since 1970-01-01 of the Monday starting the week containing the date.
function mondayIndex(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const days = Math.floor(Date.UTC(y, m - 1, d) / 86400000);
  // 1970-01-01 was a Thursday; (days + 3) % 7 is 0 for Monday.
  return days - ((days + 3) % 7);
}

export function shouldOfferWeekFlip(weekSetOn, today) {
  if (!weekSetOn) return false;
  return mondayIndex(weekSetOn) < mondayIndex(today);
}

// Which shape a chart shows: the exercise's kind, or for an 'info' exercise (or any
// other kind) the shape of its most recent entry. null when there are no entries.
export function seriesKind(entries, exercise) {
  if (isLoggedKind(exercise.kind)) return exercise.kind;
  const latest = [...entries].sort(byDateAsc).at(-1);
  return latest ? entryKind(latest) : null;
}

// Only entries of the series' shape are plotted, and never a missing value.
export function chartSeries(entries, exercise) {
  const kind = seriesKind(entries, exercise);
  return [...entries]
    .sort(byDateAsc)
    .filter(e => entryKind(e) === kind)
    .map(e => ({
      date: e.date,
      value: kind === 'timed' ? e.seconds : e.weight_kg,
      result: e.result,
      label: formatEntry(e),
    }))
    .filter(p => p.value !== null && p.value !== undefined);
}

export function chartPoints(series, width, height, pad) {
  const n = series.length;
  if (n === 0) return [];
  const values = series.map(p => p.value);
  const min = Math.min(...values), max = Math.max(...values);
  return series.map((p, i) => ({
    x: n === 1 ? width / 2 : pad + (i * (width - 2 * pad)) / (n - 1),
    y: max === min ? height / 2
      : height - pad - ((p.value - min) * (height - 2 * pad)) / (max - min),
  }));
}

export function buildRoutineRows(personId, routine, newId) {
  const sessions = [], exercises = [];
  routine.forEach((s, si) => {
    const id = newId();
    sessions.push({ id, person_id: personId, name: s.name, position: si, archived: false });
    s.exercises.forEach((e, ei) => {
      exercises.push({
        id: newId(), session_id: id, name: e.name, kind: e.kind, target: e.target,
        target_b: e.target_b, rest_seconds: e.rest_seconds, notes: e.notes,
        week: e.week, position: ei, archived: false,
      });
    });
  });
  return { sessions, exercises };
}
