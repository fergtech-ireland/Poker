-- Leagues: private groups of friends with a shared league table.
-- Holds member profile hashes, so there is no public access at all; the
-- Edge Function reads and writes it (service role) and returns a safe view.

create table public.leagues (
  code       text primary key check (code ~ '^[A-Z]{6}$'),
  version    integer not null default 1,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.leagues enable row level security;
revoke all on public.leagues from anon, authenticated;

-- Version-checked save, like save_room. p_expected = 0 creates the league.
create or replace function public.save_league(p_code text, p_expected integer, p_data jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_expected = 0 then
    insert into public.leagues (code, version, data) values (p_code, 1, p_data)
      on conflict (code) do nothing;
    return found;
  end if;
  update public.leagues set version = version + 1, data = p_data, updated_at = now()
    where code = p_code and version = p_expected;
  return found;
end;
$$;

revoke execute on function public.save_league(text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.save_league(text, integer, jsonb) to service_role;
