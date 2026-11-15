import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sendResult, sendOp, isAuthRefusal, resolveSession, createSyncGate, createRetry,
} from '../js/sync.js';

const op = { table: 'entries', rows: [{ id: 'x' }], onConflict: 'exercise_id,date' };

function fakeClient(answer) {
  const calls = [];
  return {
    calls,
    from(table) {
      return {
        upsert(rows, opts) {
          calls.push({ table, rows, opts });
          return typeof answer === 'function' ? answer() : Promise.resolve(answer);
        },
      };
    },
  };
}

test('sendResult: only 400, 409 and 422 reject; everything else retries', () => {
  for (const s of [400, 409, 422]) assert.equal(sendResult(s), 'reject', String(s));
  for (const s of [0, undefined, null, 401, 403, 404, 408, 429, 500, 502, 503, 540, 418, 302]) {
    assert.equal(sendResult(s), 'retry', String(s));
  }
});

test('sendOp maps the upsert answer', async () => {
  const ok = fakeClient({ error: null, status: 201 });
  assert.equal(await sendOp(async () => ok, op), 'ok');
  assert.deepEqual(ok.calls, [{ table: 'entries', rows: op.rows, opts: { onConflict: 'exercise_id,date' } }]);
  assert.equal(await sendOp(async () => fakeClient({ error: { message: 'bad' }, status: 400 }), op), 'reject');
  assert.equal(await sendOp(async () => fakeClient({ error: { message: 'gone' }, status: 404 }), op), 'retry');
  assert.equal(await sendOp(async () => fakeClient({ error: { message: 'slow' }, status: 429 }), op), 'retry');
  assert.equal(await sendOp(async () => fakeClient({ error: { message: 'net' }, status: 0 }), op), 'retry');
  assert.equal(await sendOp(async () => null, op), 'retry');
  assert.equal(await sendOp(async () => fakeClient(() => Promise.reject(new Error('boom'))), op), 'retry');
  assert.equal(await sendOp(async () => { throw new Error('import failed'); }, op), 'retry');
});

test('sendOp reports 401 and retries', async () => {
  let told = 0;
  const r = await sendOp(async () => fakeClient({ error: { message: 'jwt' }, status: 401 }), op, () => told++);
  assert.equal(r, 'retry');
  assert.equal(told, 1);
});

function authClient(answer) {
  return { auth: { getSession: () => (answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)) } };
}

test('isAuthRefusal', () => {
  assert.equal(isAuthRefusal(null), false);
  assert.equal(isAuthRefusal({ name: 'AuthApiError', status: 400 }), true);
  assert.equal(isAuthRefusal({ name: 'AuthApiError', status: 401 }), true);
  assert.equal(isAuthRefusal({ name: 'AuthRetryableFetchError', status: 0 }), false);
  assert.equal(isAuthRefusal({ name: 'AuthRetryableFetchError', status: 503 }), false);
  assert.equal(isAuthRefusal({ name: 'AuthUnknownError', status: 500 }), false);
  assert.equal(isAuthRefusal({ name: 'TypeError' }), false);
});

test('resolveSession: a stored session survives anything but a refusal', async () => {
  const stored = () => true;
  const none = () => false;
  const session = { data: { session: { access_token: 't' } }, error: null };
  const noSession = (error) => ({ data: { session: null }, error });
  // confirmed
  assert.equal(await resolveSession(authClient(session), none), true);
  // no client (CDN unreachable)
  assert.equal(await resolveSession(null, stored), true);
  assert.equal(await resolveSession(null, none), false);
  // refresh failed on a weak connection
  assert.equal(await resolveSession(authClient(noSession({ name: 'AuthRetryableFetchError', status: 0 })), stored), true);
  assert.equal(await resolveSession(authClient(noSession(null)), stored), true);
  assert.equal(await resolveSession(authClient(new Error('Failed to fetch')), stored), true);
  // server definitively refused the stored session
  assert.equal(await resolveSession(authClient(noSession({ name: 'AuthApiError', status: 401 })), stored), false);
  assert.equal(await resolveSession(authClient(noSession({ name: 'AuthApiError', status: 400 })), stored), false);
  // nothing stored
  assert.equal(await resolveSession(authClient(noSession(null)), none), false);
  assert.equal(await resolveSession(authClient(new Error('x')), none), false);
});

test('resolveSession reads the stored session before asking the client', async () => {
  let stored = true;
  // supabase-js removes the stored session while failing; the earlier answer counts.
  const client = { auth: { getSession: async () => { stored = false; return { data: { session: null }, error: null }; } } };
  assert.equal(await resolveSession(client, () => stored), true);
});

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
const tick = () => new Promise(r => setImmediate(r));

test('gate: refresh waits for an in-flight flush', async () => {
  const log = [];
  const f = deferred();
  const gate = createSyncGate({
    runFlush: async () => { log.push('flush start'); await f.promise; log.push('flush end'); },
    runRefresh: async () => { log.push('refresh'); },
  });
  gate.flush();
  await tick();
  const r = gate.refresh();
  await tick();
  assert.deepEqual(log, ['flush start']);
  f.resolve();
  await r;
  assert.deepEqual(log, ['flush start', 'flush end', 'refresh']);
});

test('gate: no flush starts during a refresh; it runs right after', async () => {
  const log = [];
  const reads = deferred();
  const gate = createSyncGate({
    runFlush: async () => { log.push('flush'); },
    runRefresh: async () => { log.push('reads start'); await reads.promise; log.push('reads end'); },
  });
  const r = gate.refresh();
  await tick();
  const f1 = gate.flush();
  const f2 = gate.flush();
  await tick();
  assert.deepEqual(log, ['reads start']);
  reads.resolve();
  await Promise.all([r, f1, f2]);
  assert.deepEqual(log, ['reads start', 'reads end', 'flush']);
});

test('gate: a failed refresh still lets the deferred flush run', async () => {
  const log = [];
  const gate = createSyncGate({
    runFlush: async () => { log.push('flush'); },
    runRefresh: async () => { await tick(); throw new Error('down'); },
  });
  const r = gate.refresh().catch(() => log.push('refresh failed'));
  const f = gate.flush();
  await Promise.all([r, f]);
  assert.deepEqual(log, ['refresh failed', 'flush']);
});

test('gate: concurrent refreshes share one run', async () => {
  let runs = 0;
  const gate = createSyncGate({ runFlush: async () => {}, runRefresh: async () => { runs++; await tick(); } });
  await Promise.all([gate.refresh(), gate.refresh()]);
  assert.equal(runs, 1);
});

function fakeTimers() {
  const timers = new Map();
  let next = 1;
  return {
    set: (fn, ms) => { const id = next++; timers.set(id, { fn, ms }); return id; },
    clear: id => { timers.delete(id); },
    delays: () => [...timers.values()].map(t => t.ms),
    fire() {
      const [[id, t]] = [...timers.entries()];
      timers.delete(id);
      t.fn();
    },
  };
}

test('retry: backoff 5s, 15s, 60s, then every 60s while ops stay pending', () => {
  const timers = fakeTimers();
  let flushes = 0;
  const retry = createRetry({ flush: () => flushes++, pending: () => 1, setTimer: timers.set, clearTimer: timers.clear });
  const seen = [];
  for (let i = 0; i < 5; i++) {
    retry.afterFlush();
    seen.push(...timers.delays());
    timers.fire();
  }
  assert.deepEqual(seen, [5000, 15000, 60000, 60000, 60000]);
  assert.equal(flushes, 5);
});

test('retry: success or a new write resets the backoff; only one timer at a time', () => {
  const timers = fakeTimers();
  let pending = 1;
  const retry = createRetry({ flush: () => {}, pending: () => pending, setTimer: timers.set, clearTimer: timers.clear });
  retry.afterFlush(); timers.fire();
  retry.afterFlush();
  assert.deepEqual(timers.delays(), [15000]);
  retry.afterFlush();
  assert.equal(timers.delays().length, 1);
  pending = 0;
  retry.afterFlush();
  assert.deepEqual(timers.delays(), []);
  pending = 1;
  retry.afterFlush();
  assert.deepEqual(timers.delays(), [5000]);
  timers.fire(); retry.afterFlush();
  assert.deepEqual(timers.delays(), [15000]);
  retry.reset();
  assert.deepEqual(timers.delays(), []);
  retry.afterFlush();
  assert.deepEqual(timers.delays(), [5000]);
});
