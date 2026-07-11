-- One Tribe — initial schema. Source of truth: docs/02-data-model.md + docs/00 D9.
-- Security model: reads are guarded by RLS (live only); ALL writes to content
-- tables go through server routes with the service role (D9 P1) — there are
-- deliberately no anon/authenticated write policies on them.

create type media_kind as enum ('image', 'gif', 'clip');
create type mod_status as enum ('live', 'hidden', 'flagged'); -- flagged: v2 auto-filter only

-- ── events ──────────────────────────────────────────────────────────────────
create table events (
  id uuid primary key default gen_random_uuid(),
  festival text not null,          -- 'Defqon.1' — event-agnostic by design (D1)
  edition text,                    -- anthem/theme title, e.g. 'One Tribe'
  year int not null,
  city text,
  country char(2),
  canceled boolean not null default false, -- 2026 = true (launch hook)
  constraint events_festival_year_key unique (festival, year)
);

alter table events enable row level security;
create policy events_read on events for select using (true);

-- Privileges are explicit — this CLI version grants no data access by default.
revoke all on table events from anon, authenticated;
grant select on table events to anon, authenticated;
grant all on table events to service_role;

-- ── profiles (anonymous auth — Festival Passport) ───────────────────────────
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  home_country char(2),
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;
create policy profiles_select_own on profiles for select using (auth.uid() = id);
create policy profiles_insert_own on profiles for insert with check (auth.uid() = id);
create policy profiles_update_own on profiles for update
  using (auth.uid() = id) with check (auth.uid() = id);

-- Anonymous-auth users act as `authenticated`; the unauthenticated `anon`
-- role gets no profile access at all. RLS scopes rows to the owner.
grant select, insert, update on table profiles to authenticated;
grant all on table profiles to service_role;

-- ── memories (core UGC) ─────────────────────────────────────────────────────
create table memories (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id),
  media_url text,                  -- R2 public URL (required for image/gif)
  thumb_url text,
  media_kind media_kind not null default 'image',
  embed_url text,                  -- clip only: YouTube URL (D9 P7 — MVP is YouTube-only)
  clip_start int,
  clip_length int,
  caption text,
  source_lang char(2),
  author_name text,
  author_id uuid references profiles (id) on delete set null,
  origin_country char(2),          -- request geo — powers the "M countries" counter (D9 P9)
  status mod_status not null default 'live', -- instant publish (D7)
  rights_confirmed boolean not null default false,
  takedown_token uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- clip rows need an embed URL; image/gif rows need a media file
  constraint memories_media_shape check (
    (media_kind = 'clip' and embed_url is not null)
    or (media_kind in ('image', 'gif') and media_url is not null)
  ),
  -- the legal gate, enforced at the deepest layer: no row exists without
  -- the uploader's rights attestation (docs/05). Server routes give the
  -- friendly 400; this makes bypass impossible.
  constraint memories_rights_attested check (rights_confirmed = true)
);

create index memories_status_created_idx on memories (status, created_at desc);
create index memories_event_idx on memories (event_id);

alter table memories enable row level security;
create policy memories_read_live on memories for select using (status = 'live');
-- No write policies on purpose (D9 P1): writes are service-role only.

-- RLS hides rows, not columns — without this, anyone could read
-- takedown_token from live rows and hide other people's memories.
-- Clients must select explicit columns (never '*').
revoke all on table memories from anon, authenticated;
grant select (
  id, event_id, media_url, thumb_url, media_kind, embed_url, clip_start,
  clip_length, caption, source_lang, author_name, author_id, origin_country,
  status, created_at
) on memories to anon, authenticated;
grant all on table memories to service_role;

-- ── reports (community flagging — first line of defence for D7) ─────────────
create table reports (
  id uuid primary key default gen_random_uuid(),
  memory_id uuid not null references memories (id) on delete cascade,
  reason text not null,
  reporter_hint text,              -- anonymized reporter fingerprint (IP hash)
  created_at timestamptz not null default now(),
  constraint reports_reason_check check (
    reason in ('set-rip', 'nsfw', 'minor', 'privacy', 'spam', 'other')
  )
);

create index reports_memory_idx on reports (memory_id);

alter table reports enable row level security;
create policy reports_insert on reports for insert with check (true);
-- No select policy: report contents are operator-only (service role).

revoke all on table reports from anon, authenticated;
grant insert (memory_id, reason, reporter_hint) on reports to anon, authenticated;
grant all on table reports to service_role;

-- ── translations (permanent MT cache — docs/16) ─────────────────────────────
create table translations (
  source_hash text not null,
  target_lang char(2) not null,
  text text not null,
  provider text,
  created_at timestamptz not null default now(),
  primary key (source_hash, target_lang)
);

alter table translations enable row level security;
create policy translations_read on translations for select using (true);

revoke all on table translations from anon, authenticated;
grant select on table translations to anon, authenticated;
grant all on table translations to service_role;

-- ── attendance ("my Nth Defqon") ────────────────────────────────────────────
create table attendance (
  profile_id uuid not null references profiles (id) on delete cascade,
  event_id uuid not null references events (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, event_id)
);

alter table attendance enable row level security;
create policy attendance_select_own on attendance for select using (auth.uid() = profile_id);
create policy attendance_insert_own on attendance for insert with check (auth.uid() = profile_id);
create policy attendance_delete_own on attendance for delete using (auth.uid() = profile_id);

grant select, insert, delete on table attendance to authenticated;
grant all on table attendance to service_role;

-- ── realtime: new live moments appear on the wall instantly (docs/15 §1) ────
alter publication supabase_realtime add table memories;
