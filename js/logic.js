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

function parseInt1(text) {
  const n = parseNumber(text);
  return n !== null && Number.isInteger(n) && n >= 1 ? n : null;
}

export function validateEntry(kind, raw) {
  const invalid = [];
  let weight = parseNumber(raw.weight);
  const sets = parseInt1(raw.sets);
  let reps = null, seconds = null;
  if (kind === 'weight') {
    if (weight === null) invalid.push('weight');
    if (sets === null) invalid.push('sets');
    reps = parseInt1(raw.reps);
    if (reps === null) invalid.push('reps');
  } else {
    if (String(raw.weight ?? '').trim() !== '' && weight === null) invalid.push('weight');
    if (sets === null) invalid.push('sets');
    seconds = parseInt1(raw.seconds);
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

export function lastEntry(entries, exercise, date, week) {
  const earlier = entries
    .filter(e => e.exercise_id === exercise.id && e.date < date)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  if (exercise.target_b) {
    const sameWeek = earlier.find(e => e.week === week);
    if (sameWeek) return sameWeek;
  }
  return earlier[0];
}

const num = n => String(Number(n));

export function formatEntry(entry, kind) {
  if (kind === 'timed') {
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

export function chartSeries(entries, exercise) {
  return [...entries]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map(e => ({
      date: e.date,
      value: exercise.kind === 'timed' ? e.seconds : e.weight_kg,
      result: e.result,
      label: formatEntry(e, exercise.kind),
    }));
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
