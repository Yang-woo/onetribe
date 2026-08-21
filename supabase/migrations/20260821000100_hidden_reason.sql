-- Why a moment is hidden — docs/00 D55 (follow-up to D54).
--
-- Four paths converge on status='hidden': the operator, the 3-report auto-hide,
-- the takedown token, and — since D54 — the author themselves. The row kept no
-- trace of which. In the admin console an author's deliberate removal is then
-- indistinguishable from a false-positive auto-hide: it sorts to the top of
-- `recent` with no reports attached, reads as "something the filter got wrong",
-- and `h` puts it back on the public wall in one keypress.
--
-- The first attempt at this wrote the label from all four call sites and was
-- wrong in the way four call sites are always wrong: last writer wins. A
-- takedown link clicked after a policy hide relabelled it as the uploader's own
-- choice, and the console then offered to undo it. So the label is not a column
-- four writers share — it is owned by the database:
--
--   * memories_hidden_reason_guard  a BEFORE trigger. A row that is already
--     down keeps the label it went down with, no matter who writes; a row that
--     is back on the wall carries no label at all. The label is write-once, and
--     no writer can opt out of that — not a route, not the dashboard, not a
--     future call site nobody has written yet. (Write-ONCE, not write-only-here:
--     a first hide may still be written directly, which is what keeps the
--     currently deployed code working until the app ships. What no one can do
--     is change an answer that is already on the row.)
--   * hide_memory()                 the one channel that puts a label on. Every
--     path goes through it and names itself; the credential (author id or
--     takedown token) travels in the same statement, so there is no window
--     between proving who you are and the row going down.
--   * restore_memory()              the one channel that puts a row back, and
--     where the refusal lives (see below). Not in the browser.
--
-- Deliberately PRIVATE. No anon/authenticated grant, and the realtime column
-- list (20260714000200) is not touched — the contrast with D9-b matters: new
-- *public* columns need a column grant plus a publication rebuild or anon reads
-- 42501, but this one says something about a person's intent that the wall has
-- no business publishing. Admin reads it through the service role.
--
-- Replayable start to finish: every statement is `if not exists` or `or
-- replace`, so a run that dies halfway can simply be run again. Nothing here
-- depends on being applied exactly once.

alter table public.memories
  add column if not exists hidden_reason text;

alter table public.memories
  drop constraint if exists memories_hidden_reason_known;
alter table public.memories
  add constraint memories_hidden_reason_known
    check (
      hidden_reason is null
      or hidden_reason in ('owner', 'report', 'operator', 'token')
    );

comment on column public.memories.hidden_reason is
  'Which path took this row down: owner|report|operator|token. Write-once while hidden and cleared on restore, both enforced by memories_hidden_reason_guard. NULL on live rows and on rows hidden before this column existed — unknown, NOT "safe to restore": restore_memory() refuses NULL the same way it refuses owner/token. Never granted to anon/authenticated.';

-- ── the label is the database's, not the callers' ───────────────────────────

create or replace function public.memories_hidden_reason_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status <> 'hidden' then
    -- Back on the wall, so there is nothing to explain: "its author took this
    -- down" on a live moment is simply false, and the next hide writes its own
    -- reason anyway. Restoring cannot forget to clear it because restoring
    -- does not do the clearing.
    new.hidden_reason := null;
  elsif tg_op = 'UPDATE' then
    if old.status = 'hidden' then
      -- Already down: whoever took it down owns the label, for good. This one
      -- assignment is what makes relabelling impossible rather than merely
      -- guarded against — three passers-by cannot turn an author's own
      -- takedown into 'report', and a leaked takedown link cannot launder a
      -- policy hide into 'token' and earn it a "put it back?" prompt.
      new.hidden_reason := old.hidden_reason;
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.memories_hidden_reason_guard() from public, anon, authenticated;

drop trigger if exists memories_hidden_reason_guard on public.memories;
create trigger memories_hidden_reason_guard
  before insert or update on public.memories
  for each row
  execute function public.memories_hidden_reason_guard();

-- ── the one channel that hides ──────────────────────────────────────────────

-- Returns (matched, reason): `matched` is whether a row answered to the
-- credential — false means no such moment, or not this caller's — and `reason`
-- is the label that now stands, which for an already-hidden row is the one it
-- already had. Both callers need that distinction: "already down" must read as
-- success (a double-clicked takedown link is not an invalid one), while "not
-- yours" must not.
--
-- p_author_id / p_token are the credential, applied in the same statement as
-- the write. Passing neither means "no credential required" — that is the
-- operator and the report threshold, and it is why execute is granted to
-- service_role only.
create or replace function public.hide_memory(
  p_memory_id uuid,
  p_reason text,
  p_author_id uuid default null,
  p_token uuid default null
)
returns table (matched boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text;
  v_rows int;
begin
  -- The CHECK constraint cannot catch a typo here: on an already-hidden row the
  -- guard replaces the bad value with the old one before the constraint ever
  -- looks, so a misspelled path would silently "succeed". Refuse up front.
  if p_reason is null or p_reason not in ('owner', 'report', 'operator', 'token') then
    raise exception 'hide_memory: unknown reason %', p_reason using errcode = '22023';
  end if;

  -- A NULL credential does not mean "none was given" — it makes its predicate
  -- vacuously true, so the WHERE below collapses to the id alone. That is the
  -- difference between `takedown_token = p_token` (NULL matches nothing, by
  -- three-valued logic) and `p_token is null or takedown_token = p_token`, and
  -- it is how the first cut of this function let an anonymous caller take any
  -- moment down by sending a null token. So the label and the proof it stands
  -- on are tied together here, once, for every caller present and future:
  -- name 'token' and you must produce one.
  if p_reason = 'token' and p_token is null then
    raise exception 'hide_memory: the token path requires a token' using errcode = '22023';
  end if;
  if p_reason = 'owner' and p_author_id is null then
    raise exception 'hide_memory: the owner path requires an author' using errcode = '22023';
  end if;

  update public.memories m
     set status = 'hidden',
         hidden_reason = p_reason
   where m.id = p_memory_id
     and (p_author_id is null or m.author_id = p_author_id)
     and (p_token is null or m.takedown_token = p_token)
  returning m.hidden_reason into v_reason; -- post-trigger: the label that stands
  get diagnostics v_rows = row_count;

  return query select v_rows > 0, v_reason;
end;
$$;

revoke execute on function public.hide_memory(uuid, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.hide_memory(uuid, text, uuid, uuid) to service_role;

-- ── the one channel that restores, and the refusal that lives in it ─────────

-- Outcomes: 'missing' (no such row), 'confirm' (refused — `reason` says what
-- the caller would be overruling and `report_count` what else is sitting on the
-- moment), 'restored'.
--
-- The refusal is here rather than in the console because a gate in the browser
-- is not a gate: the route did not read hidden_reason at all, so a client that
-- skipped the prompt — or held a stale queue snapshot, which the console
-- always does — restored an author's takedown with a 200. Naming the label
-- back is also a compare-and-set: acknowledge 'owner' on a row that has since
-- become something else is refused again rather than applied blind.
-- The return type gains a column, and `create or replace` cannot change one
-- (42P13), so the old shape has to go first for this file to stay replayable.
-- Grants are re-asserted below, which a drop would otherwise take with it.
drop function if exists public.restore_memory(uuid, text);

create or replace function public.restore_memory(
  p_memory_id uuid,
  p_acknowledge text default null
)
returns table (outcome text, reason text, report_count int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status mod_status;
  v_reason text;
  v_label text;
  v_reports int;
begin
  select m.status, m.hidden_reason
    into v_status, v_reason
    from public.memories m
   where m.id = p_memory_id
     for update; -- also serialises against a report landing mid-restore

  if not found then
    return query select 'missing'::text, null::text, 0;
    return;
  end if;

  if v_status = 'live' then
    return query select 'restored'::text, null::text, 0; -- already up; nothing to undo
    return;
  end if;
  -- Anything else is off the wall (`memories_read_live` passes 'live' only), so
  -- it goes through the gate rather than getting a success it did not get: a
  -- v2 'flagged' row carries no label — the guard clears it for any non-hidden
  -- status — so it reads as 'unknown' and is restored the same way.

  -- 'owner' and 'token' mean a person asked for this moment to come down, and
  -- NULL means nobody recorded who did (rows hidden before this column, or a
  -- writer that went around the channel). All three are somebody else's
  -- decision, so all three are refused until the caller names which one it is
  -- overruling. 'report' and 'operator' are moderation's own decisions and
  -- restoring them is the ordinary, frictionless flow — a prompt on every row
  -- is a prompt nobody reads.
  v_label := coalesce(v_reason, 'unknown');
  if v_label in ('owner', 'token', 'unknown')
     and (p_acknowledge is null or p_acknowledge <> v_label) then
    -- What else is on this moment, counted the way the auto-hide counts it (the
    -- expression is handle_report_threshold's — keep the two in step). Restoring
    -- one of these does NOT clear reports, on purpose, so a moment put back over
    -- three reporters goes down again on the next one. That is the safety net
    -- working, but the operator cannot see it coming: the console shows no
    -- report count per row. Hand it to them with the question.
    select count(distinct reporter_hint)
      into v_reports
      from public.reports
     where memory_id = p_memory_id
       and reporter_hint is not null;
    return query select 'confirm'::text, v_label, v_reports;
    return;
  end if;

  -- Reports are what the 3-strike auto-hide counts, so restoring while they sit
  -- on the row means the very next report hides it again — a griefer loop
  -- (docs/09 A-2). Clearing them is part of adjudicating them, which is what
  -- restoring a 'report' or 'operator' hide is. It is NOT what overruling an
  -- author's own takedown is: nobody reviewed those reports, and wiping them
  -- would erase the repeat-infringer trail (docs/09 D) as a side effect. Same
  -- for 'unknown' — we do not know what this restore adjudicates, so it
  -- adjudicates nothing. Before the status flip, inside this transaction, so
  -- no report can be counted and then have its trail wiped.
  if v_label in ('report', 'operator') then
    delete from public.reports where memory_id = p_memory_id;
  end if;

  update public.memories set status = 'live' where id = p_memory_id;

  return query select 'restored'::text, v_label, 0;
end;
$$;

revoke execute on function public.restore_memory(uuid, text) from public, anon, authenticated;
grant execute on function public.restore_memory(uuid, text) to service_role;

-- ── the two paths that hide from inside the database ────────────────────────

-- Report auto-hide (20260712000200), now through the channel. Its own guard is
-- narrower than the channel's: only a moment actually on the wall, never a
-- 'flagged' row awaiting v2 review. What stops three passers-by from
-- relabelling an author's takedown is no longer this guard but the column's.
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

  if distinct_reporters >= 3
     and exists (
       select 1 from public.memories
        where id = new.memory_id and status = 'live'
     )
  then
    perform public.hide_memory(new.memory_id, 'report');
  end if;

  return new;
end;
$$;

revoke execute on function public.handle_report_threshold() from public, anon, authenticated;

-- Uploader takedown by secret token (20260712000300, made idempotent in
-- 20260725000300). The token check moved into hide_memory's WHERE clause, so
-- this is now only "which reason a token buys" — which is exactly why it stays
-- a separate function: it is the one hiding path anon may call, and it must not
-- be able to name its own label.
create or replace function public.takedown_memory(p_memory_id uuid, p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_matched boolean;
begin
  -- No token is a wrong token, not an unconditional takedown. Answered the way
  -- the takedown page already reads it ("that link is not valid") instead of
  -- raising at an anonymous caller.
  if p_token is null then
    return false;
  end if;

  select h.matched into v_matched
    from public.hide_memory(p_memory_id, 'token', null, p_token) as h;
  -- A matching token still succeeds when the moment is already down (the label
  -- just stays whatever took it down first), so the only false is a genuinely
  -- wrong token or id — which is what lets the takedown page tell a transient
  -- error apart from a bad link.
  return coalesce(v_matched, false);
end;
$$;

revoke execute on function public.takedown_memory(uuid, uuid) from public;
grant execute on function public.takedown_memory(uuid, uuid) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
