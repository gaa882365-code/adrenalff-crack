-- ADRENALFF CRACK // схема Supabase
-- Выполни этот скрипт в SQL Editor новой пустой таблицы (Project -> SQL Editor -> New query)

create type release_status as enum ('pending','approved','rejected');
create type dignity as enum ('user','moderator','administration','owner');

-- ---------- профили (роли) ----------

create table profiles (
  id uuid primary key references auth.users on delete cascade,
  username text not null,
  role dignity not null default 'user',
  created_at timestamptz not null default now()
);

-- первый зарегистрированный автоматически становится administration
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
declare _cnt bigint;
begin
  select count(*) into _cnt from profiles;
  insert into profiles (id, username, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(coalesce(new.email,'anon'),'@',1)),
    case when _cnt = 0 then 'administration'::dignity else 'user'::dignity end
  );
  return new;
end $$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function handle_new_user();

-- ---------- релизы ----------

create table releases (
  id bigint generated always as identity primary key,
  title text not null,
  version text not null default '',
  type text not null default 'crack',
  category text not null default 'Разное',
  platform text not null default '',
  size text not null default '',
  desc text not null default '',
  download_link text not null default '',
  password text not null default '',
  status release_status not null default 'pending',
  uploader uuid references profiles(id),
  uploader_name text not null default '',
  dl integer not null default 0,
  date timestamptz not null default now(),
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz
);

create index releases_status_idx on releases (status);

-- ---------- функции прав ----------

create or replace function is_moderator(uid uuid)
returns boolean language sql security definer as $$
  select role in ('moderator','administration','owner') from profiles where id = uid;
$$;

create or replace function bump_dl(rid bigint)
returns void language sql security definer as $$
  update releases set dl = dl + 1 where id = rid;
$$;

-- ---------- RLS ----------

alter table profiles enable row level security;
alter table releases enable row level security;

create policy profiles_read on profiles
  for select using (auth.uid() = id or is_moderator(auth.uid()));

create policy profiles_update on profiles
  for update using (auth.uid() = id);

create policy releases_read_public on releases
  for select using (status = 'approved');

create policy releases_read_auth on releases
  for select to authenticated using (true);

create policy releases_insert on releases
  for insert to authenticated with check (auth.uid() = uploader and status = 'pending');

create policy releases_update on releases
  for update to authenticated using (is_moderator(auth.uid()));

create policy releases_delete on releases
  for delete to authenticated using (is_moderator(auth.uid()));