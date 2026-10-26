-- Cut Log database. Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Safe to run more than once.

create extension if not exists pgcrypto with schema extensions;

-- One row per logged day. `data` is what you tap and type in the app.
-- `health` is what the Apple Watch Shortcut sends (kept separate so neither overwrites the other).
create table if not exists public.days (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  day        date not null,
  data       jsonb not null default '{}'::jsonb,
  health     jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);
create index if not exists days_updated_idx on public.days (user_id, updated_at);

-- Plan settings (start weight, resting burn, protein rhythm, ...).
create table if not exists public.settings (
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Personal token for the Apple Health Shortcut (only a hash is stored).
create table if not exists public.health_tokens (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now()
);

-- Web push subscriptions (for reminders).
create table if not exists public.push_subs (
  endpoint   text primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  sub        jsonb not null,
  created_at timestamptz not null default now()
);

-- Row-level security: you only ever see your own rows.
alter table public.days          enable row level security;
alter table public.settings      enable row level security;
alter table public.health_tokens enable row level security;
alter table public.push_subs     enable row level security;

drop policy if exists "own days" on public.days;
create policy "own days" on public.days for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "own settings" on public.settings;
create policy "own settings" on public.settings for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "own push" on public.push_subs;
create policy "own push" on public.push_subs for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
-- health_tokens: no policies, so it is reachable only through the functions below.

-- Make a new Shortcut token (replaces the old one). Returns the token once.
create or replace function public.create_health_token()
returns text language plpgsql security definer set search_path = public, extensions as $$
declare t text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  t := encode(gen_random_bytes(24), 'hex');
  insert into public.health_tokens (user_id, token_hash) values (auth.uid(), encode(digest(t, 'sha256'), 'hex'))
  on conflict (user_id) do update set token_hash = excluded.token_hash, created_at = now();
  return t;
end $$;
revoke all on function public.create_health_token() from public, anon;
grant execute on function public.create_health_token() to authenticated;

-- Called by the iPhone Shortcut. Merges the day's Apple Health numbers into `health`.
-- payload keys: workouts, active_kcal, resting_kcal, weight_kg, steps, sleep_h
create or replace function public.health_sync(p_token text, p_day date, p_payload jsonb)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid; clean jsonb := '{}'::jsonb; k text;
begin
  select user_id into uid from public.health_tokens where token_hash = encode(digest(p_token, 'sha256'), 'hex');
  if uid is null then raise exception 'unknown token'; end if;
  if p_day is null or p_day > current_date + 1 or p_day < current_date - 60 then raise exception 'bad day'; end if;
  foreach k in array array['workouts','active_kcal','resting_kcal','weight_kg','steps','sleep_h'] loop
    if p_payload ? k and jsonb_typeof(p_payload->k) = 'number' then clean := clean || jsonb_build_object(k, p_payload->k);
    elsif p_payload ? k and jsonb_typeof(p_payload->k) = 'string' and (p_payload->>k) ~ '^[0-9]+([.,][0-9]+)?$' then
      clean := clean || jsonb_build_object(k, replace(p_payload->>k, ',', '.')::numeric);
    end if;
  end loop;
  clean := clean || jsonb_build_object('synced_at', now());
  insert into public.days (user_id, day, health, updated_at) values (uid, p_day, clean, now())
  on conflict (user_id, day) do update set health = coalesce(public.days.health, '{}'::jsonb) || excluded.health, updated_at = now();
  return 'ok';
end $$;
revoke all on function public.health_sync(text, date, jsonb) from public;
grant execute on function public.health_sync(text, date, jsonb) to anon, authenticated;

-- Private bucket for weekly progress photos: files live under <your user id>/...
insert into storage.buckets (id, name, public) values ('photos', 'photos', false) on conflict (id) do nothing;
drop policy if exists "own photos read" on storage.objects;
create policy "own photos read" on storage.objects for select to authenticated using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "own photos write" on storage.objects;
create policy "own photos write" on storage.objects for insert to authenticated with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "own photos update" on storage.objects;
create policy "own photos update" on storage.objects for update to authenticated using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "own photos delete" on storage.objects;
create policy "own photos delete" on storage.objects for delete to authenticated using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- Reminders (push notifications) ----------
-- Each subscribed phone keeps its own reminder time and which reminders it wants.
alter table public.push_subs add column if not exists prefs jsonb not null default '{"hour":20,"log":true,"protein":true,"waist":true}'::jsonb;
alter table public.push_subs add column if not exists tz text not null default 'Europe/London';
alter table public.push_subs add column if not exists last_sent date;

-- The hourly GitHub Action proves who it is with a key derived from the VAPID private key
-- (a repo secret). Only a hash is stored here, so publishing this file reveals nothing,
-- and the Supabase service_role key is never needed anywhere.
create table if not exists public.cron_keys (id int primary key default 1, key_hash text not null);
alter table public.cron_keys enable row level security;
insert into public.cron_keys (id, key_hash) values (1, 'f932542662c8bc0d8572e2575853691c9456cd928ad2871337bd624962a290ce')
on conflict (id) do update set key_hash = excluded.key_hash;

create or replace function public._cron_ok(p_key text) returns boolean
language sql security definer set search_path = public, extensions as $$
  select exists (select 1 from public.cron_keys where key_hash = encode(digest(coalesce(p_key, ''), 'sha256'), 'hex'));
$$;
revoke all on function public._cron_ok(text) from public, anon, authenticated;

-- Everything the sender needs: each phone, its owner's plan, and the last 120 days of taps.
create or replace function public.reminder_batch(p_key text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public._cron_ok(p_key) then raise exception 'bad key'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'endpoint', s.endpoint, 'sub', s.sub, 'prefs', s.prefs, 'tz', s.tz, 'last_sent', s.last_sent,
      'plan', (select st.data from public.settings st where st.user_id = s.user_id),
      'days', (select coalesce(jsonb_object_agg(d.day::text, d.data - 'health'), '{}'::jsonb)
               from public.days d where d.user_id = s.user_id and d.day >= current_date - 120)))
    from public.push_subs s), '[]'::jsonb);
end $$;

create or replace function public.reminder_done(p_key text, p_endpoint text, p_day date)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public._cron_ok(p_key) then raise exception 'bad key'; end if;
  update public.push_subs set last_sent = p_day where endpoint = p_endpoint;
end $$;

create or replace function public.reminder_drop(p_key text, p_endpoint text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public._cron_ok(p_key) then raise exception 'bad key'; end if;
  delete from public.push_subs where endpoint = p_endpoint;
end $$;

revoke all on function public.reminder_batch(text), public.reminder_done(text, text, date), public.reminder_drop(text, text) from public;
grant execute on function public.reminder_batch(text), public.reminder_done(text, text, date), public.reminder_drop(text, text) to anon;
