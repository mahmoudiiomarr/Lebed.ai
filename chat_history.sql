-- Run once in the Supabase SQL Editor.
-- Persistent chat history for authenticated users.

create table if not exists public.chats (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    title text not null default 'New Chat',
    created_at timestamptz not null default now()
);

create table if not exists public.messages (
    id uuid primary key default gen_random_uuid(),
    chat_id uuid not null references public.chats(id) on delete cascade,
    role text not null check (role in ('user', 'ai')),
    content text not null,
    created_at timestamptz not null default now()
);

create index if not exists chats_user_id_created_at_idx
    on public.chats (user_id, created_at desc);
create index if not exists messages_chat_id_created_at_idx
    on public.messages (chat_id, created_at asc);

alter table public.chats enable row level security;
alter table public.messages enable row level security;

drop policy if exists "Users can select their own chats" on public.chats;
create policy "Users can select their own chats"
    on public.chats for select to authenticated
    using (auth.uid() = user_id);

drop policy if exists "Users can insert their own chats" on public.chats;
create policy "Users can insert their own chats"
    on public.chats for insert to authenticated
    with check (auth.uid() = user_id);

drop policy if exists "Users can update their own chats" on public.chats;
create policy "Users can update their own chats"
    on public.chats for update to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own chats" on public.chats;
create policy "Users can delete their own chats"
    on public.chats for delete to authenticated
    using (auth.uid() = user_id);

drop policy if exists "Users can select messages in their own chats" on public.messages;
create policy "Users can select messages in their own chats"
    on public.messages for select to authenticated
    using (exists (
        select 1 from public.chats
        where public.chats.id = messages.chat_id
          and public.chats.user_id = auth.uid()
    ));

drop policy if exists "Users can insert messages in their own chats" on public.messages;
create policy "Users can insert messages in their own chats"
    on public.messages for insert to authenticated
    with check (exists (
        select 1 from public.chats
        where public.chats.id = messages.chat_id
          and public.chats.user_id = auth.uid()
    ));

drop policy if exists "Users can update messages in their own chats" on public.messages;
create policy "Users can update messages in their own chats"
    on public.messages for update to authenticated
    using (exists (
        select 1 from public.chats
        where public.chats.id = messages.chat_id
          and public.chats.user_id = auth.uid()
    ))
    with check (exists (
        select 1 from public.chats
        where public.chats.id = messages.chat_id
          and public.chats.user_id = auth.uid()
    ));

drop policy if exists "Users can delete messages in their own chats" on public.messages;
create policy "Users can delete messages in their own chats"
    on public.messages for delete to authenticated
    using (exists (
        select 1 from public.chats
        where public.chats.id = messages.chat_id
          and public.chats.user_id = auth.uid()
    ));
