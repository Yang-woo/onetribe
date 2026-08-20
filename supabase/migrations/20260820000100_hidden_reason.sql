-- Why a moment is hidden — docs/00 D55 (follow-up to D54).
--
-- Four paths converge on status='hidden': the operator, the 3-report auto-hide,
-- the takedown token, and — since D54 — the author themselves. The row kept no
-- trace of which. In the admin console an author's deliberate removal is then
-- indistinguishable from a false-positive auto-hide: it sorts to the top of
-- `recent` with no reports attached, reads as "something the filter got wrong",
-- and `h` puts it back on the public wall in one keypress. This column is the
-- trace that makes those two cases tellable apart.
--
-- Deliberately PRIVATE. No anon/authenticated grant, and NOT added to the
-- realtime publication — the contrast with docs/09-b matters: new *public*
-- columns need a column grant plus a publication rebuild or anon reads 42501,
-- but this one says something about a person's intent that the wall has no
-- business publishing. Admin reads it through the service role.

alter table public.memories
  add column hidden_reason text
    constraint memories_hidden_reason_known
      check (
        hidden_reason is null
        or hidden_reason in ('owner', 'report', 'operator', 'token')
      );

comment on column public.memories.hidden_reason is
  'Which path hid this row: owner|report|operator|token. NULL when live, and NULL on rows hidden before this column existed (unknown, not "none"). Never granted to anon/authenticated.';

-- ── the two paths that hide from inside the database ────────────────────────

-- Report auto-hide (20260712000200). The `status = 'live'` guard stays: it is
-- what stops a later report from relabelling a row someone already took down.
create or replace function public.handle_report_threshold()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  distinct_reporters int;
begin
  select count(distinct reporter_hint)
    into distinct_reporters
    from public.reports
    where memory_id = new.memory_id
      and reporter_hint is not null; -- anonymous/unfingerprinted reports never count

  if distinct_reporters >= 3 then
    -- live → hidden only; never resurrects hidden rows, never touches flagged
    update public.memories
      set status = 'hidden',
          hidden_reason = 'report'
      where id = new.memory_id
        and status = 'live';
  end if;

  return new;
end;
$$;

revoke execute on function public.handle_report_threshold() from public, anon, authenticated;

-- Uploader takedown by secret token (20260725000300). Still idempotent: a
-- matching token succeeds even when the row is already hidden, so a
-- double-clicked link doesn't read as "invalid".
create or replace function public.takedown_memory(p_memory_id uuid, p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  updated int;
begin
  update public.memories
    set status = 'hidden',
        hidden_reason = 'token'
    where id = p_memory_id
      and takedown_token = p_token;
  get diagnostics updated = row_count;
  return updated > 0;
end;
$$;

revoke execute on function public.takedown_memory(uuid, uuid) from public;
grant execute on function public.takedown_memory(uuid, uuid) to anon, authenticated, service_role;
