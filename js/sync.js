// Sync helpers for store.js that need no DOM, no storage and no network of their own:
// write status mapping, the session decision, refresh/flush exclusion and retry backoff.

// Only an answer saying the row itself is wrong rejects a write for good. Anything else
// (no connection, 401/403 auth trouble, 404 schema not created yet, 408/429, 5xx,
// an unknown status) may succeed later, so the write stays queued.
export function sendResult(status) {
  return status === 400 || status === 409 || status === 422 ? 'reject' : 'retry';
}

// Send one queued op through the Supabase client. Never throws.
export async function sendOp(getClient, op, onUnauthorized) {
  try {
    const client = await getClient();
    if (!client) return 'retry';
    const { error, status } = await client.from(op.table).upsert(op.rows, { onConflict: op.onConflict });
    if (!error) return 'ok';
    if (status === 401 && onUnauthorized) onUnauthorized();
    return sendResult(status);
  } catch {
    return 'retry';
  }
}

// The auth server answered and refused the stored session (revoked or expired refresh
// token). Network failures, timeouts and server errors are not a refusal.
export function isAuthRefusal(error) {
  if (!error || error.name === 'AuthRetryableFetchError') return false;
  return error.status === 400 || error.status === 401 || error.status === 403;
}

// Signed in, or a stored session that could not be confirmed for any reason other than
// the server refusing it: the phone keeps working from the cache on a weak connection.
// `hasStoredSession` is read first because supabase-js removes a session it gives up on.
export async function resolveSession(client, hasStoredSession) {
  const stored = hasStoredSession();
  if (!client) return stored;
  let answer;
  try {
    answer = await client.auth.getSession();
  } catch {
    return stored;
  }
  if (answer?.data?.session) return true;
  if (!stored) return false;
  return !isAuthRefusal(answer?.error);
}

// Refresh and flush never overlap: a refresh waits for an in-flight flush, and a flush
// asked for while a refresh reads the tables runs right after it. Otherwise an op sent
// while the reads were in flight would be in neither the snapshot nor the queue.
export function createSyncGate({ runFlush, runRefresh }) {
  let flushing = null;
  let refreshing = null;

  function flush() {
    if (refreshing) return refreshing.then(flush, flush);
    if (!flushing) {
      flushing = Promise.resolve().then(runFlush).finally(() => { flushing = null; });
    }
    return flushing;
  }

  function refresh() {
    if (!refreshing) {
      refreshing = (async () => {
        while (flushing) {
          try { await flushing; } catch { /* the flush's own problem */ }
        }
        return runRefresh();
      })().finally(() => { refreshing = null; });
    }
    return refreshing;
  }

  return { flush, refresh };
}

// After a flush that leaves ops pending, try again after 5s, 15s, 60s, then every 60s.
// A flush that empties the queue, or a new write (`reset`), starts the backoff over.
export function createRetry({
  flush, pending, delays = [5000, 15000, 60000],
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = id => clearTimeout(id),
}) {
  let attempt = 0;
  let timer = null;

  function cancel() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }

  return {
    afterFlush() {
      cancel();
      if (pending() === 0) {
        attempt = 0;
        return;
      }
      const delay = delays[Math.min(attempt, delays.length - 1)];
      attempt++;
      timer = setTimer(() => {
        timer = null;
        flush();
      }, delay);
    },
    reset() {
      attempt = 0;
      cancel();
    },
  };
}
