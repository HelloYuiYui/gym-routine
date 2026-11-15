// Data layer: in-memory state, localStorage cache, offline write queue, Supabase sync.
// When js/config.js is empty the app runs local-only: no client, no sign-in,
// writes stay queued until the owner fills in the config.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { createQueue } from './queue.js';
import { sendOp, resolveSession, createSyncGate, createRetry, loginEmail } from './sync.js';
import { buildRoutineRows, localDate } from './logic.js';
import { DEFAULT_ROUTINE } from './default-routine.js';

const SUPABASE_MODULE = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
const CACHE_KEY = 'gym.cache';
const PERSON_KEY = 'gym.person';
const QUEUE_KEY = 'gym.queue';
const TABLES = ['people', 'sessions', 'exercises', 'entries'];

export const localOnly = !(SUPABASE_URL && SUPABASE_ANON_KEY);

export const state = { people: [], sessions: [], exercises: [], entries: [] };

const newId = () => crypto.randomUUID();

// ---- Storage (every access guarded: full or blocked storage never stops the app) ----

// Each flag is true while the last write of that kind failed; the app then works from memory.
const storageFailed = { cache: false, person: false };

function readItem(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeItem(key, value, flag) {
  let ok = true;
  try {
    localStorage.setItem(key, value);
  } catch {
    ok = false;
  }
  if (storageFailed[flag] !== !ok) {
    storageFailed[flag] = !ok;
    emitSync();
  }
  return ok;
}

// localStorage itself can throw on access (blocked site data), so the queue gets a
// wrapper whose calls throw inside the queue's own guards.
const queueStorage = {
  getItem: key => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
};

// ---- Supabase client (loaded on demand, only when configured) ----

let clientPromise = null;

function getClient() {
  if (localOnly) return Promise.resolve(null);
  if (!clientPromise) {
    clientPromise = import(SUPABASE_MODULE)
      .then(({ createClient }) => createClient(SUPABASE_URL, SUPABASE_ANON_KEY))
      .catch(() => {
        clientPromise = null; // offline: try again next time
        return null;
      });
  }
  return clientPromise;
}

// Supabase keeps its session in localStorage under sb-<ref>-auth-token.
function hasStoredSession() {
  try {
    return Object.keys(localStorage).some(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
  } catch {
    return false;
  }
}

// ---- Listeners ----

const changeListeners = [];
const syncListeners = [];
const authListeners = [];
let loadError = false; // the server answered but the last load failed

export function subscribe(cb) {
  changeListeners.push(cb);
}

function changed() {
  for (const cb of changeListeners) cb();
}

function syncStatus() {
  return {
    pending: queue.pending(),
    rejected: queue.rejected(),
    storageFailed: queue.storageFailed() || storageFailed.cache || storageFailed.person,
    loadError,
  };
}

function emitSync() {
  if (!queue) return; // a storage write during module setup, before the queue exists
  const status = syncStatus();
  for (const cb of syncListeners) cb(status);
}

// cb({ pending, rejected, storageFailed, loadError }) now and after every change.
export function onSync(cb) {
  syncListeners.push(cb);
  cb(syncStatus());
}

// Called when the server answers 401: the app shows the sign-in form again.
export function onAuthRequired(cb) {
  authListeners.push(cb);
}

function authRequired() {
  authListeners.forEach(cb => cb());
}

// ---- Queue, flush, refresh ----

// Declared with let so emitSync can tell the queue is not ready yet.
let queue = null;
queue = createQueue({
  storage: queueStorage,
  key: QUEUE_KEY,
  send: op => sendOp(getClient, op, authRequired),
  onChange: emitSync,
});

const retry = createRetry({
  flush: () => flush(),
  pending: () => queue.pending(),
});

let lastRefresh = 0; // when the last successful refresh finished

const gate = createSyncGate({
  async runFlush() {
    await queue.flush();
    if (!localOnly) retry.afterFlush();
  },
  runRefresh: readServer,
});

export function flush() {
  return gate.flush();
}

// PostgREST caps a response at 1000 rows, so read each table in pages ordered by id
// until a short page comes back. Any failed page fails the whole read, so a partial
// result never replaces the cache. The thrown error carries the HTTP status (0 when
// the server was not reached).
export async function fetchTable(client, table, pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error, status } = await client.from(table).select('*')
      .order('id').range(from, from + pageSize - 1);
    if (error) {
      if (status === 401) authRequired();
      throw Object.assign(new Error(error.message || 'load failed'), { status: status || 0 });
    }
    rows.push(...data);
    if (data.length < pageSize) return rows;
  }
}

// Replace state with the server's tables. Runs inside the gate, so no flush is in flight.
async function readServer() {
  const client = await getClient();
  if (!client) return false;
  // Never read the tables without a session: as anon, row-level security answers with
  // empty tables, which would wipe the cache.
  try {
    const { data } = await client.auth.getSession();
    if (!data?.session) return false;
  } catch {
    return false;
  }
  let results;
  try {
    results = await Promise.all(TABLES.map(t => fetchTable(client, t)));
  } catch (err) {
    if (err?.status > 0 && !loadError) {
      loadError = true;
      emitSync();
    }
    return false;
  }
  TABLES.forEach((t, i) => { state[t] = results[i]; });
  // Writes the server has not accepted (still queued, or rejected) are newer than the
  // snapshot and must stay visible.
  for (const op of [...queue.rejectedOps(), ...queue.ops()]) applyRows(op.table, op.rows);
  saveCache();
  lastRefresh = Date.now();
  if (loadError) {
    loadError = false;
    emitSync();
  }
  changed();
  return true;
}

// Fetch fresh data from the server (no-op in local-only mode). Resolves true on success.
export function refresh() {
  if (localOnly) return Promise.resolve(false);
  return gate.refresh();
}

// Refresh when the last successful refresh is older than `maxAge` ms.
export function refreshIfStale(maxAge = 60000) {
  if (localOnly || Date.now() - lastRefresh <= maxAge) return Promise.resolve(false);
  return refresh();
}

// Retry soon after the phone comes back to the app.
if (!localOnly) {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') flush();
  });
}

// ---- Auth ----

export async function getSession() {
  if (localOnly) return true;
  return resolveSession(await getClient(), hasStoredSession);
}

export async function signIn(username, password) {
  if (localOnly) return {};
  const client = await getClient();
  const unreachable = 'Cannot reach the server. Check your connection and try again.';
  if (!client) return { error: unreachable };
  const { error } = await client.auth.signInWithPassword({ email: loginEmail(username), password });
  if (!error) return {};
  if (error.name === 'AuthRetryableFetchError' || !error.status) return { error: unreachable };
  return { error: error.message };
}

export async function signOut() {
  const client = await getClient();
  if (client) await client.auth.signOut();
}

// ---- Cache ----

let loaded = false; // state holds data (from the cache or the server)

function saveCache() {
  // On failure memory still holds the data and the queue still holds the writes.
  writeItem(CACHE_KEY, JSON.stringify(state), 'cache');
}

function loadCache() {
  let cached = {};
  try {
    cached = JSON.parse(readItem(CACHE_KEY)) ?? {};
  } catch {
    cached = {};
  }
  for (const t of TABLES) state[t] = Array.isArray(cached[t]) ? cached[t] : [];
  loaded = true;
}

// Replace rows by id (entries also by exercise_id + date, matching the upsert key).
function applyRows(table, rows) {
  const list = state[table];
  for (const row of rows) {
    const i = list.findIndex(r => r.id === row.id ||
      (table === 'entries' && r.exercise_id === row.exercise_id && r.date === row.date));
    if (i === -1) list.push(row);
    else list[i] = row;
  }
}

export function hasCache() {
  return readItem(CACHE_KEY) !== null;
}

// A stored session and a cache: the app can render at once and refresh in the background.
export function canStartFromCache() {
  return !localOnly && hasStoredSession() && hasCache();
}

export function loadFromCache() {
  if (!loaded) loadCache();
  changed();
}

// Cache first (only once: memory may hold writes the cache could not store), then the server.
export async function loadAll() {
  if (!loaded) loadCache();
  await refresh();
  changed();
}

// ---- Writes (optimistic: memory and cache first, then queue and flush) ----

function queued() {
  changed();
  retry.reset();
  flush();
}

function write(table, rows, onConflict = 'id') {
  applyRows(table, rows);
  saveCache();
  queue.add({ table, rows, onConflict });
  queued();
}

export function addPerson(name) {
  const person = {
    id: newId(),
    name: name.trim(),
    current_week: 'A',
    week_set_on: localDate(new Date()),
  };
  const { sessions, exercises } = buildRoutineRows(person.id, DEFAULT_ROUTINE, newId);
  applyRows('people', [person]);
  applyRows('sessions', sessions);
  applyRows('exercises', exercises);
  saveCache();
  // Parent rows first so foreign keys hold when the queue sends them in order.
  queue.add({ table: 'people', rows: [person], onConflict: 'id' });
  queue.add({ table: 'sessions', rows: sessions, onConflict: 'id' });
  queue.add({ table: 'exercises', rows: exercises, onConflict: 'id' });
  queued();
  return person;
}

export function savePerson(person) {
  write('people', [person]);
}

export function saveSession(session) {
  write('sessions', [session]);
}

export function saveExercise(exercise) {
  write('exercises', [exercise]);
}

export function saveExercises(exercises) {
  if (exercises.length) write('exercises', exercises);
}

export function saveEntry(entry) {
  const existing = state.entries.find(e => e.exercise_id === entry.exercise_id && e.date === entry.date);
  const row = {
    ...entry,
    id: existing ? existing.id : (entry.id ?? newId()),
    updated_at: new Date().toISOString(),
  };
  write('entries', [row], 'exercise_id,date');
}

// ---- Current person (per phone) ----

let personInMemory = null;

export function currentPersonId() {
  if (storageFailed.person) return personInMemory;
  return readItem(PERSON_KEY) ?? personInMemory;
}

export function setCurrentPerson(id) {
  personInMemory = id;
  writeItem(PERSON_KEY, id, 'person');
}
