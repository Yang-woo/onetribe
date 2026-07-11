-- Auto-hide on community reports — docs/00 D9 P2, docs/09 A-2.
-- 3 distinct reporter_hints hide a live memory for operator re-review.
-- SECURITY DEFINER: the reporting user cannot read reports (by design),
-- so the trigger must count them with elevated rights.

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
      set status = 'hidden'
      where id = new.memory_id
        and status = 'live';
  end if;

  return new;
end;
$$;

-- Only the trigger machinery may run this — not callable via the API.
revoke execute on function public.handle_report_threshold() from public, anon, authenticated;

create trigger reports_threshold_trigger
  after insert on public.reports
  for each row
  execute function public.handle_report_threshold();
