import test from 'node:test';
import assert from 'node:assert/strict';
import {
  localDate, parseNumber, validateEntry, visibleExercises, targetFor, todayEntry,
  lastEntry, formatEntry, shouldOfferWeekFlip, chartSeries, chartPoints, buildRoutineRows,
} from '../js/logic.js';
import { DEFAULT_ROUTINE } from '../js/default-routine.js';

test('localDate', () => {
  assert.equal(localDate(new Date(2026, 10, 15, 0, 30)), '2026-11-15');
  assert.equal(localDate(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});

test('parseNumber', () => {
  assert.equal(parseNumber('62,5'), 62.5);
  assert.equal(parseNumber(' 60 '), 60);
  assert.equal(parseNumber('0'), 0);
  assert.equal(parseNumber(''), null);
  assert.equal(parseNumber('abc'), null);
  assert.equal(parseNumber('-5'), null);
  assert.equal(parseNumber('1,2,3'), null);
});

test('validateEntry', () => {
  assert.deepEqual(validateEntry('weight', { weight: '62,5', sets: '5', reps: '5', seconds: '' }),
    { ok: true, values: { weight_kg: 62.5, sets: 5, reps: 5, seconds: null } });
  assert.deepEqual(validateEntry('weight', { weight: '', sets: '5', reps: 'x', seconds: '' }),
    { ok: false, invalid: ['weight', 'reps'] });
  assert.deepEqual(validateEntry('weight', { weight: '60', sets: '2.5', reps: '5', seconds: '' }).invalid, ['sets']);
  assert.deepEqual(validateEntry('timed', { weight: '', sets: '2', reps: '', seconds: '45' }),
    { ok: true, values: { weight_kg: null, sets: 2, reps: null, seconds: 45 } });
  assert.deepEqual(validateEntry('timed', { weight: '', sets: '0', reps: '', seconds: '' }).invalid, ['sets', 'seconds']);
});

const ex = (id, week, position, archived = false) => ({ id, week, position, archived });

test('visibleExercises', () => {
  const a = ex('a', 'both', 2), b = ex('b', 'A', 0), c = ex('c', 'B', 1), d = ex('d', 'both', 3, true);
  assert.deepEqual(visibleExercises([a, b, c, d], 'A'), [b, a]);
  assert.deepEqual(visibleExercises([a, b, c, d], 'B'), [c, a]);
});

test('targetFor', () => {
  const e = { target: '5×3 (max)', target_b: '5×5' };
  assert.equal(targetFor(e, 'A'), '5×3 (max)');
  assert.equal(targetFor(e, 'B'), '5×5');
  assert.equal(targetFor({ target: '5×5', target_b: null }, 'B'), '5×5');
  assert.equal(targetFor({ target: null, target_b: null }, 'A'), '');
});

test('todayEntry', () => {
  const e1 = { exercise_id: 'x', date: '2026-11-15' };
  const e2 = { exercise_id: 'y', date: '2026-11-15' };
  const e3 = { exercise_id: 'x', date: '2026-11-08' };
  assert.equal(todayEntry([e3, e2, e1], 'x', '2026-11-15'), e1);
  assert.equal(todayEntry([e3, e2], 'x', '2026-11-15'), undefined);
});

test('lastEntry', () => {
  const eA = { exercise_id: 'ex1', date: '2026-11-01', week: 'A' };
  const eB = { exercise_id: 'ex1', date: '2026-11-08', week: 'B' };
  const today = { exercise_id: 'ex1', date: '2026-11-15', week: 'A' };
  const plain = { id: 'ex1', target_b: null };
  const alt = { id: 'ex1', target_b: '5×5' };
  assert.equal(lastEntry([eA, eB], plain, '2026-11-15', 'A'), eB);
  assert.equal(lastEntry([eA, eB], alt, '2026-11-15', 'A'), eA);
  assert.equal(lastEntry([eB], alt, '2026-11-15', 'A'), eB);
  assert.equal(lastEntry([eA, eB, today], plain, '2026-11-15', 'A'), eB);
  assert.equal(lastEntry([today], plain, '2026-11-15', 'A'), undefined);
  assert.equal(lastEntry([], plain, '2026-11-15', 'A'), undefined);
});

test('formatEntry', () => {
  assert.equal(formatEntry({ weight_kg: 60, sets: 5, reps: 5 }, 'weight'), '60 kg 5×5');
  assert.equal(formatEntry({ weight_kg: 62.5, sets: 5, reps: 5 }, 'weight'), '62.5 kg 5×5');
  assert.equal(formatEntry({ weight_kg: null, sets: 2, seconds: 45 }, 'timed'), '2×45s');
  assert.equal(formatEntry({ weight_kg: 20, sets: 8, seconds: 30 }, 'timed'), '20 kg 8×30s');
});

test('shouldOfferWeekFlip', () => {
  assert.equal(shouldOfferWeekFlip('2026-11-13', '2026-11-15'), false);
  assert.equal(shouldOfferWeekFlip('2026-11-15', '2026-11-16'), true);
  assert.equal(shouldOfferWeekFlip(null, '2026-11-16'), false);
});

test('chartSeries', () => {
  const entries = [
    { date: '2026-11-08', weight_kg: 62, seconds: null, sets: 5, reps: 5, result: 'held' },
    { date: '2026-11-01', weight_kg: 60, seconds: null, sets: 5, reps: 5, result: 'failed' },
  ];
  assert.deepEqual(chartSeries(entries, { kind: 'weight' }), [
    { date: '2026-11-01', value: 60, result: 'failed', label: '60 kg 5×5' },
    { date: '2026-11-08', value: 62, result: 'held', label: '62 kg 5×5' },
  ]);
  const timed = [{ date: '2026-11-01', weight_kg: null, sets: 2, seconds: 45, result: 'held' }];
  assert.deepEqual(chartSeries(timed, { kind: 'timed' }),
    [{ date: '2026-11-01', value: 45, result: 'held', label: '2×45s' }]);
  assert.deepEqual(chartSeries([], { kind: 'weight' }), []);
});

test('chartPoints', () => {
  assert.deepEqual(chartPoints([], 300, 150, 20), []);
  assert.deepEqual(chartPoints([{ value: 60 }], 300, 150, 20), [{ x: 150, y: 75 }]);
  assert.deepEqual(chartPoints([{ value: 60 }, { value: 70 }], 300, 150, 20),
    [{ x: 20, y: 130 }, { x: 280, y: 20 }]);
  assert.deepEqual(chartPoints([{ value: 60 }, { value: 60 }], 300, 150, 20).map(p => p.y), [75, 75]);
});

test('buildRoutineRows', () => {
  let n = 0;
  const { sessions, exercises } = buildRoutineRows('p1', DEFAULT_ROUTINE, () => `id${++n}`);
  assert.equal(sessions.length, 3);
  assert.ok(sessions.every(s => s.person_id === 'p1' && s.archived === false));
  assert.deepEqual(sessions.map(s => s.position), [0, 1, 2]);
  assert.deepEqual(sessions.map(s => s.name), ['Upper', 'Lower', 'Isometric']);
  const sessionIds = new Set(sessions.map(s => s.id));
  assert.ok(exercises.every(e => sessionIds.has(e.session_id) && e.archived === false));
  const ids = [...sessions, ...exercises].map(r => r.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(exercises.length, DEFAULT_ROUTINE.flatMap(s => s.exercises).length);
  for (const s of sessions) {
    const pos = exercises.filter(e => e.session_id === s.id).map(e => e.position);
    assert.deepEqual(pos, pos.map((_, i) => i));
  }
  const first = exercises[0], src = DEFAULT_ROUTINE[0].exercises[0];
  assert.deepEqual(
    { name: first.name, kind: first.kind, target: first.target, target_b: first.target_b,
      rest_seconds: first.rest_seconds, notes: first.notes, week: first.week },
    { name: src.name, kind: src.kind, target: src.target, target_b: src.target_b,
      rest_seconds: src.rest_seconds, notes: src.notes, week: src.week });
});
