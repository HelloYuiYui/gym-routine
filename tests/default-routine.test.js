import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ROUTINE } from '../js/default-routine.js';

test('three sessions in order', () => {
  assert.deepEqual(DEFAULT_ROUTINE.map(s => s.name), ['Upper', 'Lower', 'Isometric']);
});
test('every exercise is well formed', () => {
  for (const ex of DEFAULT_ROUTINE.flatMap(s => s.exercises)) {
    assert.ok(ex.name.length > 0);
    assert.ok(['weight', 'timed', 'info'].includes(ex.kind));
    assert.ok(['both', 'A', 'B'].includes(ex.week));
    assert.equal(typeof ex.notes, 'string');
  }
});
test('week alternation from the routine file', () => {
  const lower = DEFAULT_ROUTINE[1].exercises;
  assert.equal(lower.find(e => e.name === 'Front Squat').week, 'A');
  assert.equal(lower.find(e => e.name === 'Zercher Squat').week, 'B');
  const dl = lower.find(e => e.name === 'Sumo Deadlift');
  assert.equal(dl.target, '5×3 (max)'); assert.equal(dl.target_b, '5×5');
  const sq = DEFAULT_ROUTINE[2].exercises.find(e => e.name === 'Back Squat');
  assert.equal(sq.target, '5×8'); assert.equal(sq.target_b, '5×5 (max)');
});
test('no off-day or Saturday content', () => {
  const names = DEFAULT_ROUTINE.flatMap(s => s.exercises).map(e => e.name).join('|');
  assert.ok(!/Wall Sit|Heel-Dig|Adductor Squeeze/.test(names));
});
test('logged exercise counts', () => {
  const count = (i, k) => DEFAULT_ROUTINE[i].exercises.filter(e => e.kind === k).length;
  assert.deepEqual([count(0,'weight'), count(0,'timed')], [5, 1]);
  assert.deepEqual([count(1,'weight'), count(1,'timed')], [7, 0]);
  assert.deepEqual([count(2,'weight'), count(2,'timed')], [1, 8]);
});
