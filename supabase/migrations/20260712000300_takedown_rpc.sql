-- One-click uploader takedown — docs/17 T1.5, docs/02.
-- Possession of the takedown_token (from the upload confirmation link) is
-- the credential; the token column itself is unreadable through the API.
-- Hides rather than deletes so the operator can audit (docs/09 C).

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
      and takedown_token = p_token
      and status <> 'hidden';
  get diagnostics updated = row_count;
  return updated > 0;
end;
$$;

revoke execute on function public.takedown_memory(uuid, uuid) from public;
grant execute on function public.takedown_memory(uuid, uuid) to anon, authenticated, service_role;
