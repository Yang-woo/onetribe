-- Durable record of an anonymous-passport fold-in (docs/00 D45, follow-up to D44).
--
-- The merge is NOT atomic and cannot be made so: its last step leaves the
-- database entirely (GoTrue deletes the anonymous user), so no transaction can
-- span it. This row is what makes the operation survivable instead. It is
-- written BEFORE anything moves and outlives the source it names, doing two jobs:
--
--   1) An upload already in flight when the merge ran still carries the source's
--      access token — captured at submit start, long before the PUTs finish.
--      Once the source is deleted that token resolves to nobody and the moment
--      would publish permanently unattributed (the exact loss D44 exists to
--      prevent). The publish path matches the token's fingerprint here and
--      credits the account that absorbed it.
--   2) If a middle step fails, this is the only evidence of the pairing — the
--      client's anonymous token is gone from storage by then. The operator can
--      finish the job, and a client retry is safe because every step is idempotent.
--
-- source_id is deliberately NOT a foreign key: it names an auth.users row that
-- this table must outlive. target_id is, so an account deletion takes its
-- mappings with it.
--
-- Service role only — RLS on with no policies (docs/00 D9 P1). The token
-- fingerprint is a sha256 of a bearer token: readable by anon it would be an
-- offline-verifiable handle on a session, so it never leaves the service role.
create table passport_merges (
  source_id uuid primary key,
  target_id uuid not null references profiles (id) on delete cascade,
  source_token_sha256 text not null,
  created_at timestamptz not null default now()
);

-- The publish path's lookup (fingerprint + recency); the per-account merge
-- ceiling reads (target_id, created_at).
create index passport_merges_token_idx on passport_merges (source_token_sha256, created_at desc);
create index passport_merges_target_idx on passport_merges (target_id, created_at desc);

alter table passport_merges enable row level security;
-- no policies: service-role only
revoke all on table passport_merges from anon, authenticated;
grant all on table passport_merges to service_role;
