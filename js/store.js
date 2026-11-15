// Data layer: in-memory state, localStorage cache, offline write queue, Supabase sync.
// When js/config.js is empty the app runs local-only: no client, no sign-in,
// writes stay queued until the owner fills in the config.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { createQueue } from './queue.js';
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
  return Object.keys(localStorage).some(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
}

// ---- Listeners ----

const changeListeners = [];
const syncListeners = [];
const authListeners = [];
let syncStatus = { pending: 0, rejected: 0 };

export function subscribe(cb) {
  changeListeners.push(cb);
}

function changed() {
  for (const cb of changeListeners) cb();
}

export function onSync(cb) {
  syncListeners.push(cb);
  cb(syncStatus.pending, syncStatus.rejected);
}

// Called when the server answers 401: the app shows the sign-in form again.
export function onAuthRequired(cb) {
  authListeners.push(cb);
}

// ---- Queue ----

async function send(op) {
  const client = await getClient();
  if (!client) return 'retry';
  const { error, status } = await client.from(op.table).upsert(op.rows, { onConflict: op.onConflict });
  if (!error) return 'ok';
  if (status === 401) authListeners.forEach(cb => cb());
  if (!status || status === 401 || status === 403 || status >= 500) return 'retry';
  return 'reject';
}

const queue = createQueue({
  storage: localStorage,
  key: QUEUE_KEY,
  send,
  onChange(pending, rejected) {
    syncStatus = { pending, rejected };
    for (const cb of syncListeners) cb(pending, rejected);
  },
});
syncStatus.pending = queue.pending();

export function flush() {
  return queue.flush();
}

// ---- Auth ----

export async function getSession() {
  if (localOnly) return true;
  const client = await getClient();
  if (!client) return hasStoredSession();
  let signedIn = false;
  try {
    const { data } = await client.auth.getSession();
    signedIn = Boolean(data.session);
  } catch {
    signedIn = false;
  }
  // Offline, an expired token cannot be refreshed; keep the phone usable from the cache.
  return signedIn || (!navigator.onLine && hasStoredSession());
}

export async function signIn(email, password) {
  if (localOnly) return {};
  const client = await getClient();
  const unreachable = 'Cannot reach the server. Check your connection and try again.';
  if (!client) return { error: unreachable };
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (!error) return {};
  if (error.name === 'AuthRetryableFetchError' || !error.status) return { error: unreachable };
  return { error: error.message };
}

export async function signOut() {
  const client = await getClient();
  if (client) await client.auth.signOut();
}

// ---- Cache ----

function saveCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(state));
  } catch {
    // storage full or blocked: memory still holds the data, the queue still holds the writes
  }
}

function loadCache() {
  let cached = {};
  try {
    cached = JSON.parse(localStorage.getItem(CACHE_KEY)) ?? {};
  } catch {
    cached = {};
  }
  for (const t of TABLES) state[t] = Array.isArray(cached[t]) ? cached[t] : [];
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

function queuedOps() {
  try {
    const ops = JSON.parse(localStorage.getItem(QUEUE_KEY));
    return Array.isArray(ops) ? ops : [];
  } catch {
    return [];
  }
}

// PostgREST caps a response at 1000 rows, so read each table in pages ordered by id
// until a short page comes back. Any failed page fails the whole read, so a partial
// result never replaces the cache.
export async function fetchTable(client, table, pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error, status } = await client.from(table).select('*')
      .order('id').range(from, from + pageSize - 1);
    if (error) {
      if (status === 401) authListeners.forEach(cb => cb());
      throw error;
    }
    rows.push(...data);
    if (data.length < pageSize) return rows;
  }
}

export async function loadAll() {
  try {
    const client = await getClient();
    if (!client) throw new Error('no backend');
    const results = await Promise.all(TABLES.map(t => fetchTable(client, t)));
    TABLES.forEach((t, i) => { state[t] = results[i]; });
    // Writes still waiting in the queue are newer than what the server returned.
    for (const op of queuedOps()) applyRows(op.table, op.rows);
    saveCache();
  } catch {
    loadCache();
  }
  changed();
}

// ---- Writes (optimistic: memory and cache first, then queue and flush) ----

function write(table, rows, onConflict = 'id') {
  applyRows(table, rows);
  saveCache();
  queue.add({ table, rows, onConflict });
  changed();
  queue.flush();
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
  changed();
  queue.flush();
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

export function currentPersonId() {
  return localStorage.getItem(PERSON_KEY);
}

export function setCurrentPerson(id) {
  localStorage.setItem(PERSON_KEY, id);
}
