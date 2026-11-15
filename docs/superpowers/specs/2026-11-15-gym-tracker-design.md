# Gym Tracker — Design

Date: 2026-11-15
Status: awaiting approval

## Intent

Three friends train together three times a week, two hours a session. Only one
of them remembers everyone's weights and the rest times between sets; when he
is absent, the others forget. This page replaces his memory: open it on a
phone in the gym, pick the session, see what each exercise was last time and
how long to rest, and record what was done today.

## Goals

- Pick a session (not a weekday) and see its exercises in order, each with
  last time's numbers, the rest time, and the form cues from the routine.
- At the end of each exercise, record one entry: weight, sets × reps (or hold
  time), and whether it was **held** or **failed**.
- Each person has their own routine and their own history. Routines start from
  `gym-routine.md` and diverge as each person edits theirs.
- Anyone in the group can view and log for anyone else.
- Edit the routine from the phone: add, rename, remove, reorder exercises,
  move them between sessions, change targets, rest times and notes.
- A progress view with one graph per logged exercise over time.
- Works with patchy gym signal.

## Non-goals

- Off-day sessions A/B and the Saturday feeder (the group does not do them).
- Tracking runs. They appear as a line in the session, nothing to fill in.
- Per-set logging. One entry per exercise per workout.
- Individual accounts, password reset, invitations.
- A backend server (Vercel). Reminders, notifications, plate calculators.

## Anti-goals

- Logging that takes more than a few taps mid-workout. If it is slower than
  asking the gymbro, it has failed.
- Losing an entry because the signal dropped.
- A routine edit by one person silently changing someone else's routine.

## Constraints

- Hosted on GitHub Pages: static files only.
- Used on phones, one-handed, between sets. Large tap targets, numeric
  keypads for number fields.
- Free tiers only. Supabase pauses a free project after about a week of
  inactivity; the owner accepts resuming it by hand if that happens.

## Approaches

| | Approach | Trade-off |
|---|---|---|
| **A (chosen)** | GitHub Pages + Supabase called directly from the page, one shared group login, name picker inside | Anyone in the group can edit anyone's data — wanted here, so one phone can log for a friend. Two free services, no build step. |
| B | Same, but one account per person | Database enforces own-data-only, but needs sign-up, reset and group-joining flows, and makes logging for a friend harder. Too much for three friends. |
| C | Vercel app + Supabase | A real backend, a third service and a build step, for nothing A lacks today. |
| dropped | Data on each phone with file backup | Cannot show the group each other's numbers. |

The owner chose A.

## Design

### Access

One Supabase email/password user shared by the group; public sign-up turned
off. Each phone signs in once and stays signed in. Row-level security: signed-in
users may read and write every table; everyone else nothing. The Supabase URL
and anon key sit in the page source — that is safe given the policies.

After sign-in, a "who are you?" picker. The choice is remembered on the phone
and can be switched from the header at any time. Switching shows that person's
routine, last numbers and graphs. People can be added and renamed in the app
(names are not hard-coded).

### Screens

One app, three views, bottom navigation.

**Workout**

```
 Enes ▾      [Upper] [Lower] [Iso]        Week A ▸

 Warm-up ▸ (collapsed list, read-only)

 Bench Press                    rest 3:00 [▶]
 Pinch shoulder blades back. Feet driven…
 last: 60 kg  5×5  ✓ held  (8 Nov)
 [ 60 ] kg   [ 5 ] × [ 5 ]    ( Held ) ( Failed )

 Dead Hangs                     rest 1:30 [▶]
 last: 2×45s  ✓ held
 [ 2 ] × [ 45 ] s             ( Held ) ( Failed )

 Run — 10 min, fastest mile (nothing to log)
```

- Inputs are prefilled with last time's values. Tapping Held or Failed saves
  the entry. Tapping again or changing a number on the same day updates that
  entry rather than adding a second one.
- A saved exercise shows as done, so progress through the session is visible.
- The rest button starts a countdown that beeps (and vibrates where the phone
  allows) at zero. Optional; ignoring it costs nothing. An exercise with no
  rest time set shows no button.
- Week A/B is per person. Exercises marked A-only or B-only appear only in
  their week. The toggle is remembered and offers to flip when a new week
  starts; the person can always set it by hand.

**Progress**

One chart per exercise that has entries, for the selected person: weight over
time for weighted exercises, seconds over time for holds. Held and failed
entries are marked differently. Tapping a point shows that entry's sets × reps.

**Routine (edit)**

Per person. Sessions and their exercises as reorderable lists. Per exercise:
name, kind, target text (e.g. "5×5"), rest time, notes, which week (both / A /
B), which session. Removing an exercise hides it from the workout but keeps its
history and graph. Sessions can be added, renamed and removed.

### Exercise kinds

- **weight** — weight (kg), sets, reps, held/failed.
- **timed** — sets, seconds, optional weight, held/failed. Covers isometric
  holds, dead hangs, carries.
- **info** — shown, never logged. Warm-up items, mobility, runs.

### Data

- `people` — id, name, current week (A/B), when the week was last set.
- `sessions` — id, person, name, position.
- `exercises` — id, session, name, kind, target, rest seconds, notes,
  week (both/A/B), position, archived.
- `entries` — id, person, exercise, date, week, weight kg, sets, reps,
  seconds, result (held/failed), unique per exercise per date.

### Starting routine

The three sessions from `gym-routine.md` (Upper, Lower, Isometric) are
converted once into a default routine shipped with the app. Adding a person
copies it into their own sessions and exercises. Rest times are not in the
file, so they start blank and are filled in from the Routine view. Individual
differences (different isos, Zercher-only, squat variations) are made by each
person editing their copy.

### Offline

The person's routine and last entries are cached on the phone. A new entry is
written to the phone first, shown as saved, and queued; the queue is sent when
there is a connection, with a small "syncing / synced" indicator. If two phones
edit the same thing, the later write wins.

### Tech

Plain HTML, CSS and JavaScript, no build step. Supabase's JavaScript client
loaded from a CDN. All sizes in kg.

## Decisions made by the designer (not asked of the owner)

- Timed exercises can carry an optional weight (loaded holds, carries).
- The app prefills last time's numbers but does not suggest what to do next;
  the group's own hold → more reps, increase → fewer reps rule stays in their
  heads.
- Removed exercises are archived, not deleted.
- People are added in-app rather than hard-coded.
- Three views inside one page rather than separate HTML pages.
- kg only.
- One entry per exercise per date; same-day changes overwrite.

## Left to the builder

- Chart drawing: a small CDN library or hand-drawn SVG.
- Visual design, within "phone, one-handed, readable at arm's length".
- File layout, and how much of the logic gets automated tests (the sync queue
  and "last entry" lookup are the parts worth testing).
- Exact rule for when to offer the week flip.
- For exercises whose target differs by week (sumo deadlift 5×3 vs 5×5),
  whether "last time" prefers the most recent entry from the same week.

## One-time setup the owner does

1. Create a Supabase project, run the provided SQL, create the shared user,
   turn off public sign-up.
2. Put the project URL and anon key in the app's config file.
3. Create the GitHub repository and enable Pages.
