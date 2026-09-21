-- ADRENALFF CRACK // схема Supabase (custom auth: ник + пароль, без почты)
-- Выполни целиком в SQL Editor. Скрипт безопасно сбрасывает всё и создаёт заново.

create extension if not exists pgcrypto;

drop trigger if exists on_auth_user_created on auth.users;
drop table if exists releases;
drop table if exists sessions;
drop table if exists accounts;
drop table if exists profiles;
drop function if exists handle_new_user;
drop function if exists is_moderator;
drop function if exists auth_register;
drop function if exists auth_login;
drop function if exists auth_me;
drop function if exists auth_logout;
drop function if exists get_releases;
drop function if exists add_release;
drop function if exists moderate;
drop function if exists bump_dl;
drop type if exists release_status;
drop type if exists dignity;

create type release_status as enum ('pending','approved','rejected');
create type dignity as enum ('user','moderator','administration','owner');

-- аккаунты, без почты
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  pass text not null,
  role public.dignity not null default 'user',
  created_at timestamptz not null default now()
);

create unique index accounts_username_lower on public.accounts (lower(username));

-- сессии (токены)
create table public.sessions (
  token text primary key,
  uid uuid not null references public.accounts (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days'
);

create table public.releases (
  id bigint generated always as identity primary key,
  title text not null,
  version text not null default '',
  type text not null default 'crack',
  category text not null default 'Разное',
  platform text not null default '',
  size text not null default '',
  "desc" text not null default '',
  download_link text not null default '',
  password text not null default '',
  status public.release_status not null default 'pending',
  uploader uuid references public.accounts (id) on delete set null,
  uploader_name text not null default '',
  dl integer not null default 0,
  date timestamptz not null default now(),
  reviewed_by uuid references public.accounts (id) on delete set null,
  reviewed_at timestamptz
);

-- закрываем прямой доступ к таблицам (только через функции)
revoke all on table public.accounts from anon, authenticated;
revoke all on table public.sessions  from anon, authenticated;
revoke all on table public.releases  from anon, authenticated;

-- ---------- auth ----------

-- регистрация: первый аккаунт -> administration
create or replace function public.auth_register(u text, p text)
returns jsonb
language plpgsql
security definer set search_path = public, extensions
as $$
declare _u text := btrim(coalesce(u, ''));
declare _p text := coalesce(p, '');
declare _role public.dignity;
declare _tok text;
begin
  if length(_u) < 3 or length(_u) > 24 or _u ~ '\s' then
    return jsonb_build_object('ok', false, 'error', 'ник: 3-24 символа, без пробелов');
  end if;
  if length(_p) < 6 then
    return jsonb_build_object('ok', false, 'error', 'пароль: минимум 6 символов');
  end if;
  if exists (select 1 from public.accounts where lower(username) = lower(_u)) then
    return jsonb_build_object('ok', false, 'error', 'этот ник уже занят');
  end if;
  _role := case
    when (select count(*) from public.accounts) = 0 then 'administration'::public.dignity
    else 'user'::public.dignity
  end;
  insert into public.accounts (id, username, pass, role)
  values (gen_random_uuid(), _u, crypt(_p, gen_salt('bf')), _role);
  _tok := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.sessions (token, uid)
  select _tok, id from public.accounts where username = _u;
  return jsonb_build_object('ok', true, 'token', _tok, 'username', _u, 'role', _role);
end;
$$;

-- вход
create or replace function public.auth_login(u text, p text)
returns jsonb
language plpgsql
security definer set search_path = public, extensions
as $$
declare a public.accounts;
declare _tok text;
begin
  select * into a from public.accounts where lower(username) = lower(btrim(coalesce(u, '')));
  if a.id is null or a.pass <> crypt(coalesce(p, ''), a.pass) then
    return jsonb_build_object('ok', false, 'error', 'неверный ник или пароль');
  end if;
  delete from public.sessions where uid = a.id;
  _tok := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.sessions (token, uid) values (_tok, a.id);
  return jsonb_build_object('ok', true, 'token', _tok, 'username', a.username, 'role', a.role);
end;
$$;

-- кто по токену
create or replace function public.auth_me(t text)
returns jsonb
language plpgsql
security definer set search_path = public, extensions
as $$
declare a public.accounts;
begin
  select ac into a
  from public.accounts ac
  join public.sessions s on s.uid = ac.id
  where s.token = t and s.expires_at > now();
  if a.id is null then
    return jsonb_build_object('ok', false);
  end if;
  return jsonb_build_object('ok', true, 'username', a.username, 'role', a.role);
end;
$$;

create or replace function public.auth_logout(t text)
returns void
language sql
security definer set search_path = public, extensions
as $$
  delete from public.sessions where token = t;
$$;

-- ---------- releases api ----------

create or replace function public.get_releases(t text)
returns table (
  id bigint, title text, version text, type text, category text, platform text,
  size text, "desc" text, download_link text, password text,
  status public.release_status, uploader uuid, uploader_name text,
  dl integer, date timestamptz
)
language sql
security definer set search_path = public, extensions
as $$
  select
    r.id, r.title, r.version, r.type, r.category, r.platform, r.size,
    r."desc", r.download_link, r.password, r.status, r.uploader, r.uploader_name,
    r.dl, r.date
  from public.releases r
  where r.status = 'approved'
     or exists (
        select 1
        from public.sessions s
        join public.accounts a on a.id = s.uid
        where s.token = t
          and s.expires_at > now()
          and (a.id = r.uploader or a.role in ('moderator', 'administration', 'owner'))
     )
  order by r.date desc;
$$;

create or replace function public.add_release(
  t text, title text, version text, type text, category text,
  platform text, size text, descr text, download_link text, password text
)
returns jsonb
language plpgsql
security definer set search_path = public, extensions
as $$
declare a public.accounts;
begin
  select ac into a
  from public.accounts ac
  join public.sessions s on s.uid = ac.id
  where s.token = t and s.expires_at > now();
  if a.id is null then
    return jsonb_build_object('ok', false, 'error', 'сессия не найдена — войди заново');
  end if;
  if btrim(coalesce(title, '')) = '' or btrim(coalesce(category, '')) = '' or btrim(coalesce(descr, '')) = '' then
    return jsonb_build_object('ok', false, 'error', 'заполни название, категорию и описание');
  end if;
  insert into public.releases (title, version, type, category, platform, size, "desc", download_link, password, uploader, uploader_name)
  values (
    btrim(title),
    btrim(coalesce(version, '')),
    btrim(coalesce(type, 'crack')),
    btrim(category),
    btrim(coalesce(platform, '')),
    btrim(coalesce(size, '')),
    btrim(descr),
    btrim(coalesce(download_link, '')),
    case when btrim(coalesce(password, '')) = '' then '-' else btrim(password) end,
    a.id,
    a.username
  );
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.moderate(t text, rid bigint, action text)
returns jsonb
language plpgsql
security definer set search_path = public, extensions
as $$
declare a public.accounts;
begin
  select ac into a
  from public.accounts ac
  join public.sessions s on s.uid = ac.id
  where s.token = t and s.expires_at > now();
  if a.id is null then
    return jsonb_build_object('ok', false, 'error', 'сессия не найдена');
  end if;
  if a.role not in ('moderator', 'administration', 'owner') then
    return jsonb_build_object('ok', false, 'error', 'нет прав модерации');
  end if;
  if action = 'approve' then
    update public.releases set status = 'approved', reviewed_by = a.id, reviewed_at = now() where id = rid;
  elsif action = 'reject' then
    update public.releases set status = 'rejected', reviewed_by = a.id, reviewed_at = now() where id = rid;
  elsif action = 'delete' then
    delete from public.releases where id = rid;
  else
    return jsonb_build_object('ok', false, 'error', 'неизвестное действие');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- счётчик скачиваний (публично)
create or replace function public.bump_dl(rid bigint)
returns void
language sql
security definer set search_path = public, extensions
as $$
  update public.releases set dl = dl + 1 where id = rid;
$$;