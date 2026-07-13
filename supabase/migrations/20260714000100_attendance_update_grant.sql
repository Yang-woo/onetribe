-- Passport edition toggle used upsert() = INSERT ... ON CONFLICT DO UPDATE,
-- which Postgres plans with an UPDATE check even when no row conflicts.
-- attendance only had select/insert/delete, so every toggle failed 42501.
-- Grant UPDATE + the owner-scoped policy so re-checking an edition is a no-op
-- upsert rather than an error. (Code review 2026-07-14.)

grant update on table attendance to authenticated;

create policy attendance_update_own on attendance for update
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);
