import test from 'node:test';
import assert from 'node:assert/strict';
import { createQueue } from '../js/queue.js';

function fakeStorage(initial) {
  const m = new Map(initial ? Object.entries(initial) : []);
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
  };
}
const op = table => ({ table, rows: [{ id: table }], onConflict: 'id' });
function scripted(results, sent = []) {
  let i = 0;
  const send = async o => {
    sent.push(o.table);
    const r = results[i++] ?? 'ok';
    if (r instanceof Error) throw r;
    return r;
  };
  return { send, sent };
}

test('add persists to storage', () => {
  const storage = fakeStorage();
  const q = createQueue({ storage, send: async () => 'ok' });
  q.add(op('a'));
  assert.equal(q.pending(), 1);
  const q2 = createQueue({ storage, send: async () => 'ok' });
  assert.equal(q2.pending(), 1);
});

test('flush sends in order and empties', async () => {
  const { send, sent } = scripted([]);
  const q = createQueue({ storage: fakeStorage(), send });
  ['a', 'b', 'c'].forEach(t => q.add(op(t)));
  await q.flush();
  assert.deepEqual(sent, ['a', 'b', 'c']);
  assert.equal(q.pending(), 0);
});

test('retry stops and keeps the rest', async () => {
  const { send, sent } = scripted(['ok', 'retry']);
  const storage = fakeStorage();
  const q = createQueue({ storage, send });
  ['a', 'b', 'c', 'd'].forEach(t => q.add(op(t)));
  await q.flush();
  assert.deepEqual(sent, ['a', 'b']);
  assert.equal(q.pending(), 3);
  assert.equal(createQueue({ storage, send }).pending(), 3);
});

test('thrown error is treated as retry', async () => {
  const { send, sent } = scripted([new Error('offline')]);
  const q = createQueue({ storage: fakeStorage(), send });
  q.add(op('a')); q.add(op('b'));
  await q.flush();
  assert.deepEqual(sent, ['a']);
  assert.equal(q.pending(), 2);
});

test('reject is dropped and does not block', async () => {
  const { send, sent } = scripted(['reject', 'ok']);
  const calls = [];
  const q = createQueue({ storage: fakeStorage(), send, onChange: (p, r) => calls.push([p, r]) });
  q.add(op('a')); q.add(op('b'));
  await q.flush();
  assert.deepEqual(sent, ['a', 'b']);
  assert.equal(q.pending(), 0);
  assert.deepEqual(calls.at(-1), [0, 1]);
});

test('concurrent flush sends each op once', async () => {
  const { send, sent } = scripted([]);
  const q = createQueue({ storage: fakeStorage(), send });
  q.add(op('a')); q.add(op('b'));
  await Promise.all([q.flush(), q.flush()]);
  assert.deepEqual(sent, ['a', 'b']);
  assert.equal(q.pending(), 0);
});

test('op added during a flush is sent by the same run', async () => {
  const sent = [];
  let q;
  const send = async o => {
    sent.push(o.table);
    if (o.table === 'a') q.add(op('b'));
    return 'ok';
  };
  q = createQueue({ storage: fakeStorage(), send });
  q.add(op('a'));
  await q.flush();
  assert.deepEqual(sent, ['a', 'b']);
  assert.equal(q.pending(), 0);
});

test('storage is updated before the next send', async () => {
  const storage = fakeStorage();
  const seen = [];
  const send = async o => {
    seen.push(createQueue({ storage, send: async () => 'ok' }).pending());
    return 'ok';
  };
  const q = createQueue({ storage, send });
  q.add(op('a')); q.add(op('b'));
  await q.flush();
  assert.deepEqual(seen, [2, 1]);
});

test('corrupt storage value starts empty', () => {
  const storage = fakeStorage({ 'gym.queue': 'not json' });
  const q = createQueue({ storage, send: async () => 'ok' });
  assert.equal(q.pending(), 0);
  q.add(op('a'));
  assert.equal(q.pending(), 1);
});
