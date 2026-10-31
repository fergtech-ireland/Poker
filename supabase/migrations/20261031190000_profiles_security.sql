-- Profiles (friends, invites), rate limits, and private rooms.

-- ---------- Profiles ----------
-- One row per player profile. Only the hash of each device's secret is stored.
-- No public access: the Edge Function (service role) reads and writes it.
create table public.profiles (
  id          text primary key check (id ~ '^[a-z0-9]{12,40}$'),
  friend_code text not null unique check (friend_code ~ '^[A-Z0-9]{8}$'),
  version     integer not null default 1,
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);
alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;

-- Version-checked save. p_expected = 0 creates (fails if the id or friend code is taken).
create or replace function public.save_profile(p_id text, p_friend_code text, p_expected integer, p_data jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_expected = 0 then
    insert into public.profiles (id, friend_code, version, data) values (p_id, p_friend_code, 1, p_data)
      on conflict do nothing;
    return found;
  end if;
  update public.profiles set version = version + 1, data = p_data, updated_at = now()
    where id = p_id and version = p_expected;
  return found;
end; $$;

revoke execute on function public.save_profile(text, text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.save_profile(text, text, integer, jsonb) to service_role;

-- ---------- Rate limits ----------
-- Counts requests per (hashed caller, kind) per time window. Rows older than a day are tidied up.
create table public.rate_limits (
  key          text not null,
  window_start timestamptz not null,
  hits         integer not null default 0,
  primary key (key, window_start)
);
alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon, authenticated;

create or replace function public.hit_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  n integer;
begin
  insert into public.rate_limits (key, window_start, hits) values (p_key, w, 1)
    on conflict (key, window_start) do update set hits = public.rate_limits.hits + 1
    returning hits into n;
  if random() < 0.01 then
    delete from public.rate_limits where window_start < now() - interval '1 day';
  end if;
  return n <= p_limit;
end; $$;

revoke execute on function public.hit_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.hit_rate_limit(text, integer, integer) to service_role;

-- ---------- Private rooms ----------
-- Rooms are no longer readable by the public key, so nobody can list other people's tables.
-- Instead of streaming the table contents, a save sends an empty "changed" ping on the room's
-- channel; phones then ask the server for the state, which checks who they are.
drop policy if exists "Anyone can view public room state" on public.rooms;
revoke select on public.rooms from anon, authenticated;
alter publication supabase_realtime drop table public.rooms;

create or replace function public.save_room(p_code text, p_expected integer, p_state jsonb, p_secret jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_expected = 0 then
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
  -- Content-free ping for live updates (public broadcast channel "room-CODE").
  perform realtime.send(jsonb_build_object('v', p_expected + 1), 'changed', 'room-' || p_code, false);
  return true;
end; $$;

revoke execute on function public.save_room(text, integer, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.save_room(text, integer, jsonb, jsonb) to service_role;
