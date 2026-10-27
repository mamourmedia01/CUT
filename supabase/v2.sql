-- Cut Log v2: body fat from the smart scale, and sleep from phone use when the Watch is off.
-- Safe to run more than once. Also appended to schema.sql.

create or replace function public.health_sync(p_token text, p_day date, p_payload jsonb)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid; clean jsonb := '{}'::jsonb; k text; v text; n numeric;
begin
  select user_id into uid from public.health_tokens where token_hash = encode(digest(p_token, 'sha256'), 'hex');
  if uid is null then raise exception 'unknown token'; end if;
  if p_day is null or p_day > current_date + 1 or p_day < current_date - 60 then raise exception 'bad day'; end if;
  foreach k in array array['workouts','active_kcal','resting_kcal','weight_kg','steps','sleep_h','sleep_min','exercise_min','rhr','hrv_ms','resp_rate','spo2','vo2max','body_fat','lean_kg'] loop
    if not (p_payload ? k) then continue; end if;
    if jsonb_typeof(p_payload->k) = 'number' then n := (p_payload->>k)::numeric;
    elsif jsonb_typeof(p_payload->k) = 'string' then
      -- Shortcuts can send "1,234.5", "96,4", "512 kcal": keep digits, read commas sensibly.
      v := regexp_replace(p_payload->>k, '[^0-9.,]', '', 'g');
      if v ~ ',' and v ~ '\.' then v := replace(v, ',', '');
      elsif v ~ '^[0-9]{1,3}(,[0-9]{3})+$' then v := replace(v, ',', '');
      else v := replace(v, ',', '.'); end if;
      if v !~ '^[0-9]+(\.[0-9]+)?$' then continue; end if;
      n := v::numeric;
    else continue; end if;
    if n <= 0 and k <> 'workouts' then continue; end if; -- empty readings arrive as 0
    if k = 'weight_kg' then
      if n > 180 then n := n / 2.20462; elsif n < 30 then n := n * 6.35029; end if; -- sent in pounds or stones
      n := round(n, 1);
    end if;
    if k = 'lean_kg' then
      if n > 180 then n := n / 2.20462; elsif n < 30 then n := n * 6.35029; end if;
      n := round(n, 1);
    end if;
    if k = 'body_fat' then
      if n <= 1 then n := n * 100; end if;           -- Health stores 0.243 for 24.3%
      if n < 2 or n > 70 then continue; end if;
      n := round(n, 1);
    end if;
    if k in ('workouts','steps','exercise_min') then n := round(n); end if;
    if k = 'spo2' and n <= 1 then n := round(n * 100, 1); end if;
    if k in ('rhr','hrv_ms','resp_rate','vo2max') then n := round(n, 1); end if;
    if k = 'sleep_min' then
      -- Shortcuts may hand over minutes or seconds; store hours.
      if n > 1440 then n := n / 3600.0; else n := n / 60.0; end if;
      if n > 0 and n < 20 then clean := clean || jsonb_build_object('sleep_h', round(n, 2)); end if;
      continue;
    end if;
    if k = 'sleep_h' and n > 24 then continue; end if;
    clean := clean || jsonb_build_object(k, n);
  end loop;
  clean := clean || jsonb_build_object('synced_at', now());
  insert into public.days (user_id, day, health, updated_at) values (uid, p_day, clean, now())
  on conflict (user_id, day) do update set health = coalesce(public.days.health, '{}'::jsonb) || excluded.health, updated_at = now();
  return 'ok';
end $$;
revoke all on function public.health_sync(text, date, jsonb) from public;
grant execute on function public.health_sync(text, date, jsonb) to anon, authenticated;

-- ---------- phone use (for sleep when the Watch is charging) ----------
-- Every time you open an app (iPhone Shortcut automation) or Cut Log itself, one timestamp is kept.
-- A long stretch with no phone use is when you slept; a "9 hours asleep" with phone use in the
-- middle of it is capped. Only timestamps are stored: never which app, never anything else.
create table if not exists public.phone_pings (
  user_id uuid not null references auth.users(id) on delete cascade,
  at      timestamptz not null default now(),
  primary key (user_id, at)
);
alter table public.phone_pings enable row level security;
drop policy if exists "own pings read" on public.phone_pings;
create policy "own pings read" on public.phone_pings for select using (auth.uid() = user_id);

create or replace function public.phone_ping_for(uid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- one per 2 minutes is plenty; keep 45 days
  if exists (select 1 from public.phone_pings where user_id = uid and at > now() - interval '2 minutes') then return; end if;
  insert into public.phone_pings (user_id, at) values (uid, now()) on conflict do nothing;
  delete from public.phone_pings where user_id = uid and at < now() - interval '45 days';
end $$;

-- from the iPhone Shortcut automation (same personal key as the Watch link)
create or replace function public.phone_ping(p_token text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid;
begin
  select user_id into uid from public.health_tokens where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex');
  if uid is null then raise exception 'unknown token'; end if;
  perform public.phone_ping_for(uid);
  return 'ok';
end $$;

-- from Cut Log itself while you're signed in
create or replace function public.phone_ping_me()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  perform public.phone_ping_for(auth.uid());
end $$;

revoke all on function public.phone_ping_for(uuid), public.phone_ping(text), public.phone_ping_me() from public, anon, authenticated;
grant execute on function public.phone_ping(text) to anon, authenticated, service_role;
grant execute on function public.phone_ping_me() to authenticated;
