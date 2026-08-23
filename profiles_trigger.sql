-- Run once in the Supabase SQL editor.
-- Creates the profiles table and a trigger that auto-populates it
-- whenever a new user signs up via Supabase Auth.

create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    email text unique,
    username text,
    created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Users may only read/update their own profile row.
create policy if not exists "Profiles are viewable by owner"
    on public.profiles for select
    using (auth.uid() = id);

create policy if not exists "Profiles are editable by owner"
    on public.profiles for update
    using (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
    insert into public.profiles (id, email, username)
    values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)))
    on conflict (id) do update set email = excluded.email;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();
