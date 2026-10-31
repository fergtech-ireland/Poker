-- Rooms for "play with friends".
-- rooms:        what every player may see. Readable by anyone, pushed live via Realtime.
-- room_secrets: deck, hole cards, player token hashes. No policies = no public access;
--               only the Edge Function (service role) reads and writes it.

create table public.rooms (
  code       text primary key check (code ~ '^[A-Z]{4}$'),
  version    integer not null default 1,
  state      jsonb not null,
  updated_at timestamptz not null default now()
);

create table public.room_secrets (
  code       text primary key references public.rooms(code) on delete cascade,
  version    integer not null default 1,
  data       jsonb not null
);

alter table public.rooms enable row level security;
alter table public.room_secrets enable row level security;

create policy "Anyone can view public room state"
  on public.rooms for select to anon, authenticated using (true);

revoke all on public.room_secrets from anon, authenticated;
revoke insert, update, delete on public.rooms from anon, authenticated;

-- Save a room only if nobody else saved it since we loaded it (optimistic locking).
-- p_expected = 0 creates a new room. Returns false if the version didn't match.
create or replace function public.save_room(p_code text, p_expected integer, p_state jsonb, p_secret jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_expected = 0 then
    -- Tidy up rooms nobody has touched for 2 days.
    delete from public.rooms where updated_at < now() - interval '2 days';
    insert into public.rooms (code, version, state) values (p_code, 1, p_state)
      on conflict (code) do nothing;
    if not found then return false; end if;
    insert into public.room_secrets (code, version, data) values (p_code, 1, p_secret);
    return true;
  end if;

  update public.room_secrets set version = version + 1, data = p_secret
    where code = p_code and version = p_expected;
  if not found then return false; end if;
  update public.rooms set version = p_expected + 1, state = p_state, updated_at = now()
    where code = p_code;
  return true;
end;
$$;

revoke execute on function public.save_room(text, integer, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.save_room(text, integer, jsonb, jsonb) to service_role;

-- Push changes to the public room state to connected players.
alter publication supabase_realtime add table public.rooms;
