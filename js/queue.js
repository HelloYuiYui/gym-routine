// Offline write queue: ops persist in `storage` and are flushed through `send`.
export function createQueue({ storage, key = 'gym.queue', send, onChange }) {
  let rejected = 0;
  let running = null;

  function load() {
    try {
      const value = JSON.parse(storage.getItem(key));
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  let ops = load();

  function save() {
    storage.setItem(key, JSON.stringify(ops));
  }

  function notify() {
    if (onChange) onChange(ops.length, rejected);
  }

  async function run() {
    while (ops.length > 0) {
      let result;
      try {
        result = await send(ops[0]);
      } catch {
        result = 'retry';
      }
      if (result === 'retry') break;
      if (result === 'reject') rejected++;
      ops.shift();
      save();
      notify();
    }
  }

  return {
    add(op) {
      ops.push(op);
      save();
      notify();
    },
    flush() {
      if (!running) {
        running = run().finally(() => { running = null; });
      }
      return running;
    },
    pending() {
      return ops.length;
    },
  };
}
