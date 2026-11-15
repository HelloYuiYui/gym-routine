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

test('reject moves the op to a persisted rejected list and does not block', async () => {
  const { send, sent } = scripted(['reject', 'ok']);
  const storage = fakeStorage();
  const calls = [];
  const q = createQueue({ storage, send, onChange: (p, r) => calls.push([p, r]) });
  q.add(op('a')); q.add(op('b'));
  await q.flush();
  assert.deepEqual(sent, ['a', 'b']);
  assert.equal(q.pending(), 0);
  assert.deepEqual(calls.at(-1), [0, 1]);
  assert.deepEqual(q.rejectedOps().map(o => o.table), ['a']);
  const stored = JSON.parse(storage.getItem('gym.queue.rejected'));
  assert.deepEqual(stored.map(o => o.table), ['a']);
  const q2 = createQueue({ storage, send });
  assert.equal(q2.rejected(), 1);
  assert.equal(q2.pending(), 0);
});

test('only an explicit ok removes an op; unknown results are retried', async () => {
  for (const result of [undefined, 'oops', null, 404]) {
    const sent = [];
    const send = async o => { sent.push(o.table); return result; };
    const q = createQueue({ storage: fakeStorage(), send });
    q.add(op('a')); q.add(op('b'));
    await q.flush();
    assert.deepEqual(sent, ['a']);
    assert.equal(q.pending(), 2);
    assert.equal(q.rejected(), 0);
  }
});

test('retry calls onChange', async () => {
  const { send } = scripted(['retry']);
  const calls = [];
  const q = createQueue({ storage: fakeStorage(), send, onChange: (p, r) => calls.push([p, r]) });
  q.add(op('a'));
  calls.length = 0;
  await q.flush();
  assert.deepEqual(calls, [[1, 0]]);
});

test('every op gets a unique id', () => {
  const q = createQueue({ storage: fakeStorage(), send: async () => 'ok' });
  q.add(op('a')); q.add(op('a'));
  const ids = q.ops().map(o => o.id);
  assert.equal(ids.length, 2);
  assert.ok(ids.every(id => typeof id === 'string' && id.length > 0));
  assert.notEqual(ids[0], ids[1]);
});

test('setItem that throws: add does not throw, pending is right, flush still sends', async () => {
  const storage = fakeStorage();
  storage.setItem = () => { throw new Error('QuotaExceededError'); };
  const { send, sent } = scripted(['ok', 'retry']);
  const calls = [];
  const q = createQueue({ storage, send, onChange: (p, r) => calls.push([p, r]) });
  assert.doesNotThrow(() => { q.add(op('a')); q.add(op('b')); });
  assert.equal(q.pending(), 2);
  assert.equal(q.storageFailed(), true);
  await q.flush();
  assert.deepEqual(sent, ['a', 'b']);
  assert.equal(q.pending(), 1);
  assert.deepEqual(calls.at(-1), [1, 0]);
});

test('getItem that throws starts empty and keeps working from memory', async () => {
  const storage = fakeStorage();
  storage.getItem = () => { throw new Error('SecurityError'); };
  const { send, sent } = scripted([]);
  const q = createQueue({ storage, send });
  q.add(op('a'));
  assert.equal(q.pending(), 1);
  await q.flush();
  assert.deepEqual(sent, ['a']);
  assert.equal(q.pending(), 0);
});

test('storage that recovers clears the failure flag', () => {
  const storage = fakeStorage();
  const realSet = storage.setItem;
  let full = true;
  storage.setItem = (k, v) => { if (full) throw new Error('full'); realSet(k, v); };
  const q = createQueue({ storage, send: async () => 'ok' });
  q.add(op('a'));
  assert.equal(q.storageFailed(), true);
  full = false;
  q.add(op('b'));
  assert.equal(q.storageFailed(), false);
  assert.equal(createQueue({ storage, send: async () => 'ok' }).pending(), 2);
});

test('two queues on one storage: both ops survive and each is sent once', async () => {
  const storage = fakeStorage();
  const sent = [];
  const send = async o => { sent.push(o.table); return 'ok'; };
  const q1 = createQueue({ storage, send });
  const q2 = createQueue({ storage, send });
  q1.add(op('a'));
  q2.add(op('b'));
  assert.equal(q1.pending(), 2);
  assert.equal(q2.pending(), 2);
  await q1.flush();
  assert.deepEqual(sent, ['a', 'b']);
  assert.equal(q1.pending(), 0);
  assert.equal(q2.pending(), 0);
  await q2.flush();
  assert.deepEqual(sent, ['a', 'b']);
});

test('an op sent by another tab is removed by id, not by position', async () => {
  const storage = fakeStorage();
  const q1 = createQueue({ storage, send: async () => 'ok' });
  q1.add(op('a')); q1.add(op('b'));
  let q2;
  const sent = [];
  // While q2 is sending 'a', q1 flushes 'a' and 'b' too, then a new op 'c' is added.
  q2 = createQueue({ storage, send: async o => {
    sent.push(o.table);
    if (sent.length === 1) { await q1.flush(); q1.add(op('c')); }
    return 'ok';
  } });
  await q2.flush();
  assert.deepEqual(sent, ['a', 'c']);
  assert.equal(q1.pending(), 0);
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
