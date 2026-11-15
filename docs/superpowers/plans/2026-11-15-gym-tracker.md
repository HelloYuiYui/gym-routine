# Gym Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A phone-first static page where three training partners pick a session, see last time's numbers and rest times, log one entry per exercise, edit their own routine, and view progress graphs.

**Architecture:** Static files on GitHub Pages, no build step. ES modules in the browser talk to Supabase directly under one shared login. Pure logic (`logic.js`, `queue.js`) is separated from Supabase access (`store.js`) and DOM code (`views/`), so the logic is tested with Node's built-in runner. Every write goes to a localStorage queue first and is flushed to Supabase when online.

**Tech Stack:** HTML, CSS, vanilla JS (ES modules). `@supabase/supabase-js@2` from `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm`. Tests: `node --test` (Node 20+), no npm dependencies. Charts: hand-drawn inline SVG.

**Spec:** `docs/superpowers/specs/2026-11-15-gym-tracker-design.md`

## Global Constraints

- Static files only; must work when served from a GitHub Pages sub-path (all URLs relative, no leading `/`).
- No build step, no npm dependencies. `package.json` exists only for `"type": "module"` and `"test": "node --test"`.
- Phone, one-handed: tap targets at least 44px; number fields use `inputmode="decimal"` (weight) or `inputmode="numeric"` (sets, reps, seconds).
- All weights in kg.
- All user-typed text (names, notes, targets) is rendered with `textContent`, never `innerHTML`.
- Row ids are generated on the client with `crypto.randomUUID()` so rows can be created offline.
- Dates are the phone's **local** calendar date as `YYYY-MM-DD`.
- One entry per exercise per date; a same-day change overwrites.
- Removing an exercise or session sets `archived = true`; nothing with history is deleted.
- Kinds: `weight`, `timed`, `info`. Results: `held`, `failed`. Weeks: `A`, `B`; exercise week filter: `both`, `A`, `B`.

## Review Focus

1. **Decimal comma** — a phone keypad that types `62,5` must save 62.5, not fail or save 62. (Task 2, `parseNumber`)
2. **Local date near midnight / non-UTC timezone** — an entry logged at 00:30 local in UTC+3 is dated the local day, not the UTC day. (Task 2, `localDate`)
3. **Queue durability** — pending writes survive a page reload, are sent in order, and one write the server permanently rejects does not block the ones behind it. (Task 3)
4. **Empty and single-point history** — a person with no entries sees an empty state on Progress; an exercise with one entry draws one point without dividing by zero. (Task 2, `chartSeries`; Task 7)
5. **Blank or nonsense input on save** — tapping Held with an empty or non-numeric required field saves nothing and marks the field. (Task 2, `validateEntry`; Task 5)

---

## File Structure

| File | Responsibility |
|---|---|
| `index.html` | Shell: sign-in form, header (person picker, sync indicator), three view containers, bottom nav |
| `css/style.css` | All styling |
| `js/config.js` | `SUPABASE_URL`, `SUPABASE_ANON_KEY` |
| `js/default-routine.js` | `DEFAULT_ROUTINE` data |
| `js/logic.js` | Pure functions, no DOM, no network |
| `js/queue.js` | Offline write queue, storage and sender injected |
| `js/store.js` | Supabase client, auth, load/cache, writes through the queue |
| `js/timer.js` | Rest countdown |
| `js/views/workout.js`, `progress.js`, `routine.js` | One view each |
| `js/app.js` | Boot, sign-in, person picker, navigation |
| `supabase/schema.sql` | Tables and policies |
| `tests/*.test.js` | Node tests for `default-routine`, `logic`, `queue` |
| `README.md` | One-time setup steps |

---

### Task 1: Repository, schema, default routine

**Files:**
- Create: `package.json`, `.gitignore`, `supabase/schema.sql`, `js/default-routine.js`, `js/config.js`
- Test: `tests/default-routine.test.js`

**Interfaces:**
- Produces: `DEFAULT_ROUTINE: Array<{ name: string, exercises: Array<{ name, kind, target, target_b, rest_seconds, notes, week }> }>` — `target_b`, `rest_seconds` nullable; `notes` string (may be empty); order in the arrays is display order.
- Produces: tables below.

- [ ] **Step 1: `git init`, create `package.json`** with `{"private": true, "type": "module", "scripts": {"test": "node --test"}}` and `.gitignore` with `.DS_Store`.

- [ ] **Step 2: Write `supabase/schema.sql`**

```
people    (id uuid pk, name text not null, current_week text not null default 'A' check in ('A','B'),
           week_set_on date, created_at timestamptz default now())
sessions  (id uuid pk, person_id uuid not null → people on delete cascade, name text not null,
           position int not null, archived boolean not null default false)
exercises (id uuid pk, session_id uuid not null → sessions on delete cascade, name text not null,
           kind text not null check in ('weight','timed','info'), target text, target_b text,
           rest_seconds int, notes text not null default '', week text not null default 'both'
           check in ('both','A','B'), position int not null, archived boolean not null default false)
entries   (id uuid pk, person_id uuid not null → people on delete cascade,
           exercise_id uuid not null → exercises on delete cascade, date date not null,
           week text not null check in ('A','B'), weight_kg numeric, sets int not null, reps int,
           seconds int, result text not null check in ('held','failed'),
           updated_at timestamptz default now(), unique (exercise_id, date))
```

Enable row level security on all four; one policy per table: `for all to authenticated using (true) with check (true)`. No policy for `anon`.

- [ ] **Step 3: Write the failing test** `tests/default-routine.test.js`

```js
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
```

- [ ] **Step 4: Run** `npm test` — Expected: FAIL, cannot find `js/default-routine.js`.

- [ ] **Step 5: Write `js/default-routine.js`** from `gym-routine.md` lines 1–87 only (Monday → `Upper`, Wednesday → `Lower`, Friday → `Isometric`), keeping file order. Logged exercises:

| Session | Name | Kind | target | target_b | week | rest_seconds |
|---|---|---|---|---|---|---|
| Upper | Bench Press | weight | 5×5 | | both | |
| Upper | Overhead Press | weight | 3×6–8 | | both | |
| Upper | Pendlay Row | weight | 4×8–12 | | both | |
| Upper | Inclined Curls | weight | 3×10–12 | | both | |
| Upper | Assisted Pull-Up | weight | 3×8–10 | | both | |
| Upper | Dead Hangs | timed | 2×max (30s+) | | both | |
| Lower | Sumo Deadlift | weight | 5×3 (max) | 5×5 | both | |
| Lower | Speed Squat | weight | 6×3 @ 55–65% | | both | |
| Lower | Front Squat | weight | 3×6 | | A | |
| Lower | Zercher Squat | weight | 3×6 | | B | |
| Lower | Close-Grip Bench Press | weight | 3×10 (5 normal + 5 paused) | | both | |
| Lower | Leg Extension | weight | 3×10–12 | | both | |
| Lower | Leg Curl | weight | 3×10–12 | | both | |
| Isometric | Back Squat | weight | 5×8 | 5×5 (max) | both | |
| Isometric | Standing Calf Raise Iso | timed | 3×30–45s | | both | |
| Isometric | Bent-Knee Calf Raise Iso | timed | 3×30–45s | | both | |
| Isometric | Copenhagen Plank | timed | 4×20–40s per side | | both | |
| Isometric | Mid-Thigh Pull Iso | timed | 5×3–6s | | both | 120 |
| Isometric | Pin Press Iso | timed | 4×3–6s | | both | |
| Isometric | Spanish Squat Hold | timed | 5×30–45s | | both | |
| Isometric | Pallof Press Hold | timed | 4×20–45s | | both | |
| Isometric | Farmer's Carry | timed | 8–12 rounds × 30s | | both | 60 |

Every other warm-up, mobility, cool-down and run line becomes an `info` exercise in file position with its sets/protocol as `target`. `Focus:`, `Tip:`, `Note:`, `Rule:`, `Intensity:`, `Progression:`, `Setup:` lines go verbatim into the `notes` of the exercise they follow. `rest_seconds` is `null` except the two above.

- [ ] **Step 6: Write `js/config.js`** exporting `SUPABASE_URL = ''` and `SUPABASE_ANON_KEY = ''` with a comment pointing to the README.

- [ ] **Step 7: Run** `npm test` — Expected: PASS (5 tests).

- [ ] **Step 8: Commit** — `git add -A && git commit -m "chore: scaffold, schema, default routine"`

---

### Task 2: Pure logic

**Files:**
- Create: `js/logic.js`
- Test: `tests/logic.test.js`

**Interfaces:**
- Consumes: `DEFAULT_ROUTINE` (Task 1).
- Produces (all exported from `js/logic.js`):
  - `localDate(d: Date): string` — `YYYY-MM-DD` from local getters.
  - `parseNumber(text: string): number | null` — trims, accepts `,` or `.` as decimal separator; `null` for empty, non-numeric or negative.
  - `validateEntry(kind: 'weight'|'timed', raw: {weight, sets, reps, seconds}): { ok: true, values: {weight_kg, sets, reps, seconds} } | { ok: false, invalid: string[] }` — raw fields are strings. `weight`: weight (≥0), sets (≥1 integer), reps (≥1 integer) required; `seconds` null. `timed`: sets, seconds (≥1 integers) required; weight optional (blank → null); `reps` null. `invalid` lists the offending field names.
  - `visibleExercises(exercises, week: 'A'|'B'): Exercise[]` — not archived, `week` is `both` or matches, sorted by `position`.
  - `targetFor(exercise, week): string` — `target_b` when week is `B` and `target_b` is non-empty, else `target` (or `''`).
  - `todayEntry(entries, exerciseId, date): Entry | undefined`.
  - `lastEntry(entries, exercise, date, week): Entry | undefined` — most recent entry for the exercise with `entry.date < date`; if `exercise.target_b` is non-empty, prefer the most recent with `entry.week === week`, falling back to the most recent overall.
  - `formatEntry(entry, kind): string` — weight: `60 kg 5×5`; timed: `2×45s`, or `20 kg 8×30s` when `weight_kg` is not null. Weights print without trailing zeros (`62.5`, `60`).
  - `shouldOfferWeekFlip(weekSetOn: string | null, today: string): boolean` — true when `weekSetOn` is non-null and falls in an earlier Monday-started calendar week than `today`.
  - `chartSeries(entries, exercise): Array<{ date, value, result, label }>` — ascending by date; `value` is `weight_kg` for `weight`, `seconds` for `timed`; `label` is `formatEntry`.
  - `chartPoints(series, width, height, pad): Array<{ x, y }>` — linear scales; one point → horizontally and vertically centred; all values equal → vertically centred.
  - `buildRoutineRows(personId, routine, newId: () => string): { sessions: Row[], exercises: Row[] }` — rows ready to insert; `position` is the array index.

- [ ] **Step 1: Write the failing tests** — one `test()` per bullet:

```js
// localDate
assert.equal(localDate(new Date(2026, 10, 15, 0, 30)), '2026-11-15');
assert.equal(localDate(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
// parseNumber
assert.equal(parseNumber('62,5'), 62.5);  assert.equal(parseNumber(' 60 '), 60);
assert.equal(parseNumber('0'), 0);        assert.equal(parseNumber(''), null);
assert.equal(parseNumber('abc'), null);   assert.equal(parseNumber('-5'), null);
assert.equal(parseNumber('1,2,3'), null);
// validateEntry
assert.deepEqual(validateEntry('weight', {weight:'62,5', sets:'5', reps:'5', seconds:''}),
  {ok:true, values:{weight_kg:62.5, sets:5, reps:5, seconds:null}});
assert.deepEqual(validateEntry('weight', {weight:'', sets:'5', reps:'x', seconds:''}),
  {ok:false, invalid:['weight','reps']});
assert.deepEqual(validateEntry('weight', {weight:'60', sets:'2.5', reps:'5', seconds:''}).invalid, ['sets']);
assert.deepEqual(validateEntry('timed', {weight:'', sets:'2', reps:'', seconds:'45'}),
  {ok:true, values:{weight_kg:null, sets:2, reps:null, seconds:45}});
assert.deepEqual(validateEntry('timed', {weight:'', sets:'0', reps:'', seconds:''}).invalid, ['sets','seconds']);
// visibleExercises: given a (both,pos 2), b (A,pos 0), c (B,pos 1), d (both, archived)
//   week 'A' → [b, a];  week 'B' → [c, a]
// targetFor: {target:'5×3 (max)', target_b:'5×5'} → A '5×3 (max)', B '5×5'; {target:'5×5', target_b:null} B → '5×5'
// todayEntry: returns the entry matching exercise and date; undefined otherwise
// lastEntry: entries for ex1 on 11-01 (A), 11-08 (B); date 11-15, week A
//   exercise without target_b → the 11-08 entry
//   exercise with target_b   → the 11-01 entry
//   exercise with target_b, week A, only a B entry exists → that B entry
//   an entry dated 11-15 is never returned for date 11-15
//   no entries → undefined
// formatEntry
assert.equal(formatEntry({weight_kg:60, sets:5, reps:5}, 'weight'), '60 kg 5×5');
assert.equal(formatEntry({weight_kg:62.5, sets:5, reps:5}, 'weight'), '62.5 kg 5×5');
assert.equal(formatEntry({weight_kg:null, sets:2, seconds:45}, 'timed'), '2×45s');
assert.equal(formatEntry({weight_kg:20, sets:8, seconds:30}, 'timed'), '20 kg 8×30s');
// shouldOfferWeekFlip (2026-11-09 and 2026-11-16 are Mondays)
assert.equal(shouldOfferWeekFlip('2026-11-13', '2026-11-15'), false); // Fri → Sun, same week
assert.equal(shouldOfferWeekFlip('2026-11-15', '2026-11-16'), true);  // Sun → Mon
assert.equal(shouldOfferWeekFlip(null, '2026-11-16'), false);
// chartSeries: unsorted input comes back ascending; value is weight_kg for weight, seconds for timed; [] for no entries
// chartPoints
assert.deepEqual(chartPoints([], 300, 150, 20), []);
assert.deepEqual(chartPoints([{value:60}], 300, 150, 20), [{x:150, y:75}]);
// two points 60 → 70: first {x:20, y:130}, second {x:280, y:20}
// two points 60, 60: both y = 75
// buildRoutineRows with DEFAULT_ROUTINE and a counter id: 3 sessions all with person_id, positions 0..2;
//   every exercise row's session_id is one of the session ids; ids are unique; exercise positions restart at 0 per session
```

- [ ] **Step 2: Run** `npm test` — Expected: FAIL, `js/logic.js` not found.
- [ ] **Step 3: Implement the functions in `js/logic.js`** to the signatures above. No imports from the DOM or Supabase.
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat: pure logic for entries, weeks, charts, seeding"` (after `git add`).

---

### Task 3: Offline write queue

**Files:**
- Create: `js/queue.js`
- Test: `tests/queue.test.js`

**Interfaces:**
- Produces: `createQueue({ storage, key = 'gym.queue', send, onChange }): { add(op), flush(): Promise<void>, pending(): number }`
  - `op`: `{ table: string, rows: object[], onConflict: string }` (always an upsert).
  - `storage`: object with `getItem` / `setItem` (localStorage in the app, a Map-backed fake in tests).
  - `send(op): Promise<'ok' | 'retry' | 'reject'>` — `retry` means network/auth trouble, `reject` means the server will never accept it.
  - `onChange(pendingCount, rejectedCount)` called after every add and after every op settles.
  - `flush` sends oldest first. `ok` → remove and continue. `reject` → remove, count it, continue. `retry` or a thrown error → stop, keep it and everything behind it. Concurrent `flush` calls share one run.

- [ ] **Step 1: Write the failing tests**

```js
test('add persists to storage', ...)            // new queue on the same storage reports pending() === 1
test('flush sends in order and empties', ...)   // sent tables: ['a','b','c'], pending() === 0
test('retry stops and keeps the rest', ...)     // send → ok, retry: sent ['a','b'], pending() === 2
test('thrown error is treated as retry', ...)
test('reject is dropped and does not block', ...) // send → reject, ok: pending() === 0, onChange last call (0, 1)
test('concurrent flush sends each op once', ...)  // two flush() calls without await → each op sent once
test('corrupt storage value starts empty', ...)   // storage holds 'not json' → pending() === 0, add works
```

- [ ] **Step 2: Run** `npm test` — Expected: FAIL, `js/queue.js` not found.
- [ ] **Step 3: Implement `createQueue`** in `js/queue.js`.
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: offline write queue"`.

---

### Task 4: Store, sign-in, person picker

**Prerequisite (owner):** Supabase project created, `supabase/schema.sql` run, one user created under Authentication, public sign-ups off, URL and anon key pasted into `js/config.js`. Write these steps into `README.md` as part of this task.

**Files:**
- Create: `js/store.js`, `js/app.js`, `index.html`, `css/style.css`, `README.md`

**Interfaces:**
- Consumes: `createQueue` (Task 3); `buildRoutineRows`, `localDate` (Task 2); `DEFAULT_ROUTINE`; config.
- Produces (from `js/store.js`):
  - `getSession(): Promise<boolean>`, `signIn(email, password): Promise<{ error?: string }>`, `signOut(): Promise<void>`
  - `loadAll(): Promise<void>` — fetches `people`, `sessions`, `exercises`, `entries` into memory and caches them in localStorage (`gym.cache`); when the fetch fails, loads from the cache instead.
  - `state: { people, sessions, exercises, entries }` — arrays, kept current by the write functions below (optimistic: memory and cache update immediately, then the op is queued and flushed).
  - `addPerson(name): Person` — inserts the person and their copy of `DEFAULT_ROUTINE`.
  - `savePerson(person)`, `saveSession(session)`, `saveExercise(exercise)`, `saveExercises(exercises[])` — upsert by `id`.
  - `saveEntry(entry)` — upsert on `exercise_id,date`; when an entry for that exercise and date already exists in `state`, its `id` is reused.
  - `currentPersonId(): string | null`, `setCurrentPerson(id)` — localStorage `gym.person`.
  - `onSync(cb: (pending, rejected) => void)`, `flush()`.
- Produces (from `js/app.js`): calls `render(container, { personId })` exported by each view module when the view, person or data changes. Until Tasks 5–7 land, views are placeholders.
- `send` mapping for the queue: success → `ok`; fetch/network failure or HTTP 401/403/5xx → `retry`; any other error → `reject`. On a 401, show the sign-in form again without clearing the queue.

- [ ] **Step 1: Write `index.html`** — sign-in form (email, password); header with person `<select>` plus "Add person…" option, week toggle slot, sync indicator; `<main>` with `#view-workout`, `#view-progress`, `#view-routine`; bottom nav with three buttons; `<script type="module" src="js/app.js">`. Viewport meta for phones.
- [ ] **Step 2: Write `js/store.js`** to the interface above.
- [ ] **Step 3: Write `js/app.js`** — boot: no session → sign-in form; session → `loadAll()`, then person picker if `currentPersonId()` is null or unknown, else show Workout. Flush the queue on boot, on the `online` event, and after every write. Sync indicator text: `Synced`, `Syncing n…`, `Offline — n saved on this phone`, and `n not saved` when rejected > 0.
- [ ] **Step 4: Write `css/style.css`** — base layout, fixed bottom nav, 44px minimum controls, readable at arm's length, light and dark via `prefers-color-scheme`.
- [ ] **Step 5: Write `README.md`** — Supabase setup (project, SQL, user, disable sign-ups, config values), local run (`python3 -m http.server 8000`), GitHub Pages steps.
- [ ] **Step 6: Verify in a browser** — run `python3 -m http.server 8000`, open `http://localhost:8000`:
  - wrong password shows an error; right password reaches the person picker;
  - "Add person…" → name → Supabase table editor shows 1 person, 3 sessions, about 40 exercises;
  - reload keeps the session and the chosen person;
  - DevTools offline → reload → app still opens from cache; add a second person offline → indicator shows pending → back online → indicator returns to `Synced` and the rows exist.
- [ ] **Step 7: Run** `npm test` — Expected: PASS (unchanged).
- [ ] **Step 8: Commit** — `git commit -m "feat: sign-in, people, synced store"`.

---

### Task 5: Workout view and rest timer

**Files:**
- Create: `js/views/workout.js`, `js/timer.js`
- Modify: `js/app.js` (mount the view, week toggle in the header), `css/style.css`

**Interfaces:**
- Consumes: `state`, `saveEntry`, `savePerson` (Task 4); `visibleExercises`, `targetFor`, `todayEntry`, `lastEntry`, `formatEntry`, `validateEntry`, `shouldOfferWeekFlip`, `localDate` (Task 2).
- Produces: `render(container, { personId })` from `js/views/workout.js`; `startTimer(seconds, onTick: (remaining) => void, onDone: () => void): () => void` (returns a cancel function) from `js/timer.js`.

- [ ] **Step 1: Write `js/timer.js`** — counts from an end timestamp (`Date.now()`), not by decrementing, so a backgrounded tab stays accurate. On done: a short beep through `AudioContext` and `navigator.vibrate?.(400)`. Starting a new timer cancels the running one.
- [ ] **Step 2: Write `js/views/workout.js`:**
  - Session buttons for the person's non-archived sessions by `position`; the chosen session is remembered per person in localStorage (`gym.session.<personId>`). No session preselected on a new day.
  - Week toggle shows `Week A` / `Week B`; tapping flips it and saves `current_week` and `week_set_on = today`. When `shouldOfferWeekFlip` is true, show a one-line banner "New week — switch to Week X?" with Yes / Keep; either answer sets `week_set_on = today`. A person whose `week_set_on` is null gets it set to today silently.
  - `info` exercises: one compact line (name, target, notes), no inputs.
  - `weight` and `timed` exercises: name, `targetFor`, rest time as `m:ss` with a start button (hidden when `rest_seconds` is null), notes, `last: <formatEntry> ✓ held|✗ failed (<date>)` or `no entry yet`, inputs, Held and Failed buttons.
  - Inputs: `weight` kind → kg, sets, reps; `timed` kind → sets, seconds, optional kg. Prefill from today's entry if it exists, else from `lastEntry`, else empty.
  - Tapping Held or Failed runs `validateEntry`; invalid fields get an error style and nothing is saved; valid → `saveEntry` with `date = localDate(new Date())` and the person's current week. The card shows a done state with the chosen result highlighted. Changing a number after saving and tapping a result again updates the same entry.
- [ ] **Step 3: Verify in a browser** (phone-sized viewport):
  - Lower, Week A shows Front Squat and not Zercher Squat; Week B the reverse; Sumo Deadlift target reads `5×3 (max)` in A and `5×5` in B;
  - save Bench Press `62,5` kg 5×5 Held → card marked done; Supabase `entries` has one row with `weight_kg = 62.5`;
  - change to 60 and tap Failed → still one row for today, updated;
  - tap Held with reps empty → nothing saved, reps field marked;
  - set an entry's date back a week in Supabase, reload → it shows as `last:` and prefills the inputs;
  - Mid-Thigh Pull Iso shows `rest 2:00` and the countdown beeps at zero; Bench Press shows no timer button;
  - switch person in the header → that person's sessions and last numbers appear;
  - DevTools offline → save an entry → card shows done, indicator shows pending → online → synced.
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: workout logging and rest timer"`.

---

### Task 6: Routine editing

**Files:**
- Create: `js/views/routine.js`
- Modify: `css/style.css`

**Interfaces:**
- Consumes: `state`, `saveSession`, `saveExercise`, `saveExercises` (Task 4).
- Produces: `render(container, { personId })` from `js/views/routine.js`.

- [ ] **Step 1: Write `js/views/routine.js`:**
  - Lists the selected person's non-archived sessions, each with its non-archived exercises in order.
  - Session: rename, move up/down, remove (confirm, sets `archived`), "Add session".
  - Exercise row: name and target; up/down buttons (swap `position` with the neighbour, saved with `saveExercises`); tap to open an edit form.
  - Edit form fields: name, kind (weight / timed / info), target, Week B target (optional), rest as minutes and seconds (blank = none), notes, week (both / A / B), session (select — changing it moves the exercise to the end of that session). Save, Cancel, Remove (confirm, sets `archived`).
  - "Add exercise" at the end of each session opens the same form with kind `weight`.
  - Name is required; other fields may be blank.
- [ ] **Step 2: Verify in a browser:**
  - set Bench Press rest to 3:00 → Workout shows `rest 3:00` with a timer;
  - remove Front Squat and set Zercher Squat to `both` → Zercher shows in both weeks, Front Squat in neither, its past entries still in Supabase;
  - move Leg Curl above Leg Extension → order persists after reload;
  - move an exercise to another session; add a new timed exercise and log it on Workout;
  - make all these edits as person 1, switch to person 2 → person 2's routine is unchanged;
  - an exercise named `<b>x</b>` displays literally.
- [ ] **Step 3: Run** `npm test` — Expected: PASS.
- [ ] **Step 4: Commit** — `git commit -m "feat: per-person routine editing"`.

---

### Task 7: Progress view

**Files:**
- Create: `js/views/progress.js`
- Modify: `css/style.css`

**Interfaces:**
- Consumes: `state` (Task 4); `chartSeries`, `chartPoints`, `formatEntry` (Task 2).
- Produces: `render(container, { personId })` from `js/views/progress.js`.

- [ ] **Step 1: Write `js/views/progress.js`:**
  - For the selected person, one card per `weight` or `timed` exercise that has at least one entry (archived exercises included, labelled "removed"), grouped by session in routine order.
  - Each card: exercise name, unit (`kg` or `s`), latest value, and an inline SVG line chart from `chartPoints` with min and max value labels and first and last date labels. Held points are filled circles, failed points hollow with a different colour; both carry an SVG `<title>` and tapping a point shows `<date> — <label> — held|failed` under the chart.
  - No entries at all → "Nothing logged yet. Entries you save on the Workout tab will show up here."
- [ ] **Step 2: Verify in a browser:**
  - a person with no entries sees the empty state;
  - an exercise with one entry draws a single centred point;
  - insert four back-dated Bench Press entries in Supabase (60 held, 62.5 failed, 62.5 held, 65 held) → line rises left to right, the failed point looks different, tapping it shows its sets × reps;
  - a timed exercise charts seconds; switching person switches the charts.
- [ ] **Step 3: Run** `npm test` — Expected: PASS.
- [ ] **Step 4: Commit** — `git commit -m "feat: progress charts"`.

---

### Task 8: Publish and phone check

**Files:**
- Modify: `README.md` (final URL), `index.html` (title, `theme-color`, `apple-mobile-web-app-capable` meta so it can be added to the home screen)

- [ ] **Step 1: Owner creates the GitHub repository; push `main`; enable Pages** (Settings → Pages → Deploy from branch → `main`, root).
- [ ] **Step 2: Verify on a real phone at the Pages URL** — sign in, add the three people, log one `weight` and one `timed` entry, start a rest timer, edit one rest time, open Progress; turn on airplane mode, log an entry, turn it off, confirm the indicator returns to `Synced`.
- [ ] **Step 3: Commit and push** — `git commit -m "docs: setup and live URL"`.
