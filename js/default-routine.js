// Default routine, transcribed from gym-routine.md (Monday, Wednesday, Friday).
// Array order is display order. kind: 'weight' | 'timed' | 'info'; week: 'both' | 'A' | 'B'.

const ex = (name, kind, target, o = {}) => ({
  name,
  kind,
  target,
  target_b: o.target_b ?? null,
  rest_seconds: o.rest_seconds ?? null,
  notes: o.notes ?? '',
  week: o.week ?? 'both',
});
const info = (name, target, notes) => ex(name, 'info', target, { notes });

export const DEFAULT_ROUTINE = [
  {
    name: 'Upper',
    exercises: [
      info('Dynamic', 'Arm circles, torso twists.'),
      info('Shoulder Dislocates (Band Pass-Throughs)', '2 sets × 10 reps (Mobility Insert).'),
      info('Wall Angels', '2 sets × 10 reps (Mobility Insert).'),
      info('Goblet Squat', '1 set × 8 reps.'),
      info('KB Swing', '1 set × 15 reps.'),
      info('Overhead Squat', '2 sets × 8 reps (Empty bar/PVC pipe).'),
      ex('Bench Press', 'weight', '5×5', {
        notes: 'Focus: Pinch shoulder blades back. Feet driven into the floor.',
      }),
      ex('Overhead Press', 'weight', '3×6–8', {
        notes: 'Focus: Squeeze glutes and abs. Lock out fully.',
      }),
      ex('Pendlay Row', 'weight', '4×8–12', {
        notes: 'Focus: Explosive pull, controlled lower.\nTip: Use Lifting Straps if your forearms are tired from the curls.',
      }),
      ex('Inclined Curls', 'weight', '3×10–12', {
        notes: 'Focus: Elbow health and grip strength.\nNote: Do not fail on grip here; save some for the rows.',
      }),
      ex('Assisted Pull-Up', 'weight', '3×8–10', {
        notes: 'Focus: Full stretch at the bottom.',
      }),
      ex('Dead Hangs', 'timed', '2×max (30s+)', { notes: 'Focus: Decompress spine.' }),
      info('Sleeper Stretch', '2 sets × 30s per side (Do NOT do this before lifting).'),
      info(
        'Run',
        '"Fastest Mile" Attempt. (alternating weeks)',
        'Position: LAST\nGoal: Max effort (HR 180+). Empty the tank.'
      ),
    ],
  },
  {
    name: 'Lower',
    exercises: [
      info('90/90 Hip Switch', '2 mins continuous flow (Mobility Insert).'),
      info('Hip CARs (Standing)', '3 slow circles per leg (Mobility Insert).'),
      info('Bodyweight Cossack Squat', '2 sets × 6 per side (Mobility Insert).'),
      info('Goblet Squat', '2 sets × 8 reps (Sit deep).'),
      info('KB Swing', '2 sets × 15 reps (Wake up in hamstrings).'),
      ex('Sumo Deadlift', 'weight', '5×3 (max)', {
        target_b: '5×5',
        notes: 'Rule: RESET every rep. Stand up, breathe, re-brace.',
      }),
      ex('Speed Squat', 'weight', '6×3 @ 55–65%'),
      ex('Front Squat', 'weight', '3×6', { week: 'A' }),
      ex('Zercher Squat', 'weight', '3×6', { week: 'B' }),
      ex('Close-Grip Bench Press', 'weight', '3×10 (5 normal + 5 paused)', {
        notes: 'Focus: Hands shoulder-width. Elbows tucked.',
      }),
      ex('Leg Extension', 'weight', '3×10–12'),
      ex('Leg Curl', 'weight', '3×10–12'),
      info(
        'Run',
        'HIIT Walk/Jog Intervals.',
        'Position: LAST\nGoal: HR ~150. Hard walk (incline) mixed with jog. Do not max sprint.'
      ),
    ],
  },
  {
    name: 'Isometric',
    exercises: [
      info(
        'Run',
        'Moderate Steady State.',
        'Position: FIRST\nGoal: Consistent pace (Between Mon and Wed intensity).'
      ),
      info('Goblet Squat', '1 set × 8 reps.'),
      info('KB Swing', '1 set × 15 reps.'),
      info('Mobility Flow', 'Quick 90/90s + Shoulder Dislocates combined.'),
      ex('Back Squat', 'weight', '5×8', { target_b: '5×5 (max)' }),
      ex('Standing Calf Raise Iso', 'timed', '3×30–45s', {
        notes: 'Progression: Start 30s. Work to 90s. Then add load/intensity.',
      }),
      ex('Bent-Knee Calf Raise Iso', 'timed', '3×30–45s'),
      ex('Copenhagen Plank', 'timed', '4×20–40s per side', {
        notes: 'Intensity: RPE 7–9\nProgression: short-lever Copenhagen → long-lever Copenhagen → weighted Copenhagen',
      }),
      ex('Mid-Thigh Pull Iso', 'timed', '5×3–6s', {
        rest_seconds: 120,
        notes: 'Intensity: RPE 9–10\nSetup: bar or strap at mid-thigh height, brace like a deadlift, pull violently but without jerking your spine.',
      }),
      ex('Pin Press Iso', 'timed', '4×3–6s', { notes: 'Intensity: RPE 9' }),
      ex('Spanish Squat Hold', 'timed', '5×30–45s', { notes: 'Intensity: RPE 9.' }),
      ex('Pallof Press Hold', 'timed', '4×20–45s'),
      ex('Farmer\'s Carry', 'timed', '8–12 rounds × 30s', { rest_seconds: 60 }),
    ],
  },
];
