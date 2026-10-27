-- Cut Log: Autopilot + usernames (safe to run more than once). Also appended to schema.sql.

-- which reminder kinds each phone has had today: {"morning":"2026-10-27","evening":...,"stalled":...}
alter table public.push_subs add column if not exists sent jsonb not null default '{}'::jsonb;

-- ---------- usernames ----------
create table if not exists public.profiles (
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  username   text unique check (username ~ '^[a-z0-9_.]{3,20}$'),
  display_name text check (char_length(display_name) <= 40),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists "own profile read" on public.profiles;
create policy "own profile read" on public.profiles for select using (auth.uid() = user_id);

-- set (or change) your username and name; usernames are lower case, 3–20 of a–z 0–9 _ .
create or replace function public.set_profile(p_username text, p_display text)
returns json language plpgsql security definer set search_path = public as $$
declare u text := nullif(lower(trim(both from regexp_replace(coalesce(p_username, ''), '^@', ''))), '');
        d text := nullif(trim(both from coalesce(p_display, '')), '');
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if u is not null and u !~ '^[a-z0-9_.]{3,20}$' then raise exception 'bad username'; end if;
  if u is not null and exists (select 1 from public.profiles where username = u and user_id <> auth.uid()) then raise exception 'username taken'; end if;
  insert into public.profiles (user_id, username, display_name, updated_at) values (auth.uid(), u, left(d, 40), now())
  on conflict (user_id) do update set username = excluded.username, display_name = excluded.display_name, updated_at = now();
  return json_build_object('username', u, 'display_name', left(d, 40));
end $$;

-- is a username free? (true/false only, never who has it)
create or replace function public.username_free(p_username text)
returns boolean language sql security definer set search_path = public as $$
  select not exists (select 1 from public.profiles where username = lower(regexp_replace(p_username, '^@', '')) and user_id is distinct from auth.uid());
$$;

-- only the server (service key) may turn a username into an email, for "sign in with username"
create or replace function public.email_for_username(p_username text)
returns text language sql security definer set search_path = public, auth as $$
  select u.email from public.profiles p join auth.users u on u.id = p.user_id where p.username = lower(p_username) limit 1;
$$;

revoke all on function public.set_profile(text, text), public.username_free(text), public.email_for_username(text) from public, anon, authenticated;
grant execute on function public.set_profile(text, text), public.username_free(text) to authenticated;
grant execute on function public.email_for_username(text) to service_role;

-- ---------- the clock: run the reminder/autopilot function every 15 minutes, inside Supabase ----------
-- (more reliable than GitHub's scheduler, which can skip hours). Fill in your project URL and anon key:
-- create extension if not exists pg_cron;
-- create extension if not exists pg_net with schema extensions;
-- select cron.unschedule('cut-run') where exists (select 1 from cron.job where jobname = 'cut-run');
-- select cron.schedule('cut-run', '*/15 * * * *', $$
--   select net.http_post(
--     url := 'https://<project>.supabase.co/functions/v1/cut?action=run',
--     headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', '<anon key>', 'Authorization', 'Bearer <anon key>'),
--     body := '{}'::jsonb, timeout_milliseconds := 20000);
-- $$);
