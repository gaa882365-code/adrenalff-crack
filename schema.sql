-- ADRENALFF CRACK // схема Supabase (reset + create)
-- Выполни целиком в SQL Editor. Скрипт безопасно сбрасывает всё и создаёт заново.

drop trigger if exists on_auth_user_created on auth.users;
drop table if exists releases;
drop table if exists profiles;
drop function if exists handle_new_user;
drop function if exists is_moderator;
drop function if exists bump_dl;
drop type if exists release_status;
drop type if exists dignity;

create type release_status as enum ('pending','approved','rejected');
create type dignity as enum ('user','moderator','administration','owner');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  role public.dignity not null default 'user',
  created_at timestamptz not null default now()
);

-- первый зарегистрированный автоматически становится administration
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare _cnt bigint;
begin
  select count(*) into _cnt from public.profiles;
  insert into public.profiles (id, username, role)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'username',
      split_part(coalesce(new.email, 'anon'), '@', 1)
    ),
    case
      when _cnt = 0 then 'administration'::public.dignity
      else 'user'::public.dignity
    end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

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
  uploader uuid references profiles (id) on delete set null,
  uploader_name text not null default '',
  dl integer not null default 0,
  date timestamptz not null default now(),
  reviewed_by uuid references profiles (id) on delete set null,
  reviewed_at timestamptz
);

create index releases_status_idx on public.releases (status);

create or replace function public.is_moderator(uid uuid)
returns boolean
language sql
security definer set search_path = public
as $$
  select role in ('moderator', 'administration', 'owner')
  from public.profiles
  where id = uid;
$$;

create or replace function public.bump_dl(rid bigint)
returns void
language sql
security definer set search_path = public
as $$
  update public.releases set dl = dl + 1 where id = rid;
$$;

alter table public.profiles enable row level security;
alter table public.releases enable row level security;

create policy profiles_read on public.profiles
  for select using (auth.uid() = id or public.is_moderator(auth.uid()));

create policy profiles_update on public.profiles
  for update using (auth.uid() = id);

create policy releases_read_public on public.releases
  for select using (status = 'approved');

create policy releases_read_auth on public.releases
  for select to authenticated using (true);

create policy releases_insert on public.releases
  for insert to authenticated with check (auth.uid() = uploader and status = 'pending');

create policy releases_update on public.releases
  for update to authenticated using (public.is_moderator(auth.uid()));

create policy releases_delete on public.releases
  for delete to authenticated using (public.is_moderator(auth.uid()));