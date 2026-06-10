-- Settled — Supabase schema (free tier). Run in the Supabase SQL editor.
-- This is the DEPLOY path. Local dev uses the Python relay and needs none of this.

create table if not exists rooms (
  code        text primary key,
  restaurants jsonb not null,          -- single cached search, room lifetime only
  match_rule  jsonb not null,
  created_at  timestamptz default now()
);

create table if not exists participants (
  id         text not null,
  room_code  text not null references rooms(code) on delete cascade,
  name       text,
  joined_at  timestamptz default now(),
  primary key (room_code, id)
);

create table if not exists swipes (
  id             bigserial primary key,
  room_code      text not null references rooms(code) on delete cascade,
  participant_id text not null,
  restaurant_id  text not null,
  dir            text not null check (dir in ('yes','no')),
  created_at     timestamptz default now()
);

create table if not exists matches (
  room_code     text not null references rooms(code) on delete cascade,
  restaurant_id text not null,
  created_at    timestamptz default now(),
  primary key (room_code)            -- one match per room (idempotent insert)
);

create table if not exists events (
  id         bigserial primary key,
  type       text not null,
  room_code  text,
  payload    jsonb,
  created_at timestamptz default now()
);

-- Realtime: broadcast row changes for live sync.
alter publication supabase_realtime add table swipes;
alter publication supabase_realtime add table participants;

-- Table-level GRANTs. RLS policies (below) only filter rows for roles that
-- ALREADY have table privileges — without these grants the anon role hits
-- "permission denied for table" (42501). The new sb_publishable_... API keys
-- map to the anon role, so grant it (and authenticated) access here.
-- Sequence grants are required for the bigserial inserts on swipes/events.
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to anon, authenticated;
grant all on all sequences in schema public to anon, authenticated;

-- ⚠️ Row Level Security: this anonymous validator uses permissive policies so the
-- public anon key can read/write room data. Acceptable for a throwaway prototype.
-- TIGHTEN before any real launch (e.g. scope writes to the active room).
alter table rooms        enable row level security;
alter table participants enable row level security;
alter table swipes       enable row level security;
alter table matches      enable row level security;
alter table events       enable row level security;

do $$
declare t text;
begin
  foreach t in array array['rooms','participants','swipes','matches','events'] loop
    execute format(
      'create policy %I_anon_all on %I for all to anon using (true) with check (true);',
      t, t);
  end loop;
end $$;
