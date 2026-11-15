create table people (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  current_week text not null default 'A' check (current_week in ('A', 'B')),
  week_set_on date,
  created_at timestamptz default now()
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people (id) on delete cascade,
  name text not null,
  position int not null,
  archived boolean not null default false
);

create table exercises (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions (id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('weight', 'timed', 'info')),
  target text,
  target_b text,
  rest_seconds int,
  notes text not null default '',
  week text not null default 'both' check (week in ('both', 'A', 'B')),
  position int not null,
  archived boolean not null default false
);

create table entries (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people (id) on delete cascade,
  exercise_id uuid not null references exercises (id) on delete cascade,
  date date not null,
  week text not null check (week in ('A', 'B')),
  weight_kg numeric,
  sets int not null,
  reps int,
  seconds int,
  result text not null check (result in ('held', 'failed')),
  updated_at timestamptz default now(),
  unique (exercise_id, date)
);

alter table people enable row level security;
alter table sessions enable row level security;
alter table exercises enable row level security;
alter table entries enable row level security;

create policy "authenticated full access" on people
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on sessions
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on exercises
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on entries
  for all to authenticated using (true) with check (true);
