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

-- reports: remove the direct anon write path
drop policy reports_insert on reports;
revoke insert on table reports from anon, authenticated;
