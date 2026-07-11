-- W2 upload support.
--
-- 1) Rate limiting storage — server routes count recent uploads per IP hash
--    (D9 P4). Service-role only; never exposed through the API.
-- 2) memories.author_link — optional Instagram link from the upload form
--    (docs/15 §2 step 3; was missing from the 02 sketch).
-- 3) Reports become server-only too: a client-supplied reporter_hint would
--    let anyone forge 3 distinct hints and auto-hide any memory (censorship
--    griefing). The server route computes the hint from the real IP, so the
--    threshold counts real reporters. Extends D9 P1 to reports.

create table upload_events (
  ip_hash text not null,
  created_at timestamptz not null default now()
);
create index upload_events_ip_idx on upload_events (ip_hash, created_at desc);

alter table upload_events enable row level security;
-- no policies: service-role only
grant all on table upload_events to service_role;

alter table memories add column author_link text;
grant select (author_link) on memories to anon, authenticated;

-- reports: remove the direct anon write path
drop policy reports_insert on reports;
revoke insert on table reports from anon, authenticated;

-- Realtime must not leak takedown_token either: column grants only guard
-- the REST API, so the publication itself carries an explicit column list
-- (PG15 publication column lists).
alter publication supabase_realtime drop table memories;
alter publication supabase_realtime add table memories (
  id, event_id, media_url, thumb_url, media_kind, embed_url, clip_start,
  clip_length, caption, source_lang, author_name, author_link,
  origin_country, status, created_at
);

-- Live wall counters ("N moments · M countries", D9 P9). The view runs with
-- owner rights but only ever exposes two aggregates over live rows.
create view wall_counters as
  select
    count(*)::int as moments,
    count(distinct origin_country)::int as countries
  from memories
  where status = 'live';

grant select on wall_counters to anon, authenticated, service_role;
