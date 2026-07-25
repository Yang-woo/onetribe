-- takedown_memory returned false for a VALID token when the moment was already
-- hidden (the `status <> 'hidden'` guard), so a double-clicked takedown link
-- showed "invalid" even though the moment is down (docs/00, review 2026-07-25).
-- Make it idempotent: a matching token always succeeds (the update is a no-op
-- when already hidden), so the only false is a genuinely wrong token/id. That
-- lets the takedown page tell a transient RPC error apart from a bad link.
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
    set status = 'hidden'
    where id = p_memory_id
      and takedown_token = p_token;
  get diagnostics updated = row_count;
  return updated > 0;
end;
$$;

-- create or replace preserves grants, but re-assert them so this file stands
-- alone if replayed against a fresh database.
revoke execute on function public.takedown_memory(uuid, uuid) from public;
grant execute on function public.takedown_memory(uuid, uuid) to anon, authenticated, service_role;
