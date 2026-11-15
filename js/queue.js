// Offline write queue: ops persist in `storage` and are flushed through `send`.
//
// `send(op)` resolves 'ok' (sent: the op is removed), 'reject' (the server refused it
// for good: the op moves to the persisted rejected list) or anything else, which is
// treated as 'retry' (the op stays and the run stops).
//
// Several page instances (tabs) may share one storage, so every mutation re-reads
// storage first and removes ops by their `id`, never by position. If storage fails
// (full or blocked), the queue keeps working from memory and `storageFailed()` is true.
const defaultId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export function createQueue({ storage, key = 'gym.queue', send, onChange, newId = defaultId }) {
  const rejectedKey = `${key}.rejected`;
  let running = null;
  let failed = false; // the last write failed: storage is behind memory
  const mem = { [key]: [], [rejectedKey]: [] };

  function read(k) {
    if (failed) return mem[k];
    let raw;
    try {
      raw = storage.getItem(k);
    } catch {
      return mem[k];
    }
    let list;
    try {
      list = JSON.parse(raw);
    } catch {
      list = [];
    }
    mem[k] = Array.isArray(list) ? list : [];
    return mem[k];
  }

  function write() {
    try {
      storage.setItem(key, JSON.stringify(mem[key]));
      storage.setItem(rejectedKey, JSON.stringify(mem[rejectedKey]));
      failed = false;
    } catch {
      failed = true;
    }
  }

  // Read both lists fresh, change them, write them back.
  function mutate(fn) {
    const ops = read(key);
    const rejected = read(rejectedKey);
    const next = fn({ ops: [...ops], rejected: [...rejected] });
    mem[key] = next.ops;
    mem[rejectedKey] = next.rejected;
    write();
  }

  // Ops written before ids existed get one now, so they can be removed by id.
  function withIds() {
    const ops = read(key);
    if (ops.every(o => o && o.id)) return ops;
    mutate(({ ops, rejected }) => ({ ops: ops.map(o => (o && o.id ? o : { ...o, id: newId() })), rejected }));
    return mem[key];
  }

  function notify() {
    if (onChange) onChange(read(key).length, read(rejectedKey).length);
  }

  async function run() {
    for (;;) {
      const op = withIds()[0];
      if (!op) return;
      let result;
      try {
        result = await send(op);
      } catch {
        result = 'retry';
      }
      if (result === 'ok') {
        mutate(({ ops, rejected }) => ({ ops: ops.filter(o => o.id !== op.id), rejected }));
      } else if (result === 'reject') {
        mutate(({ ops, rejected }) => ({
          ops: ops.filter(o => o.id !== op.id),
          rejected: rejected.some(o => o.id === op.id) ? rejected : [...rejected, op],
        }));
      } else {
        notify();
        return;
      }
      notify();
    }
  }

  return {
    add(op) {
      mutate(({ ops, rejected }) => ({ ops: [...ops, { ...op, id: op.id ?? newId() }], rejected }));
      notify();
    },
    flush() {
      if (!running) {
        running = run().finally(() => { running = null; });
      }
      return running;
    },
    pending() {
      return read(key).length;
    },
    rejected() {
      return read(rejectedKey).length;
    },
    ops() {
      return [...read(key)];
    },
    rejectedOps() {
      return [...read(rejectedKey)];
    },
    storageFailed() {
      return failed;
    },
  };
}
