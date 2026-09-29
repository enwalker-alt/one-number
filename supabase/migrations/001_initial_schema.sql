-- One Number MVP schema. Run this in Supabase SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone_number text unique,
  pin_hash text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.integrations (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('gmail')), status text not null default 'disconnected' check (status in ('connected','disconnected')),
  access_token_encrypted text, refresh_token_encrypted text, token_expiry timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(user_id, provider)
);
create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, email text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(user_id, name)
);
create table if not exists public.call_sessions (
  id uuid primary key default gen_random_uuid(), call_sid text not null unique, user_id uuid not null references auth.users(id) on delete cascade,
  state text not null default 'awaiting_pin', draft_recipient_name text, draft_recipient_email text, draft_subject text, draft_body text,
  confirmation_pending boolean not null default false, history jsonb not null default '[]'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.actions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, call_sid text,
  type text not null check (type = 'send_email'), recipient_name text, recipient_email text, subject text, body text, status text not null check (status in ('sent','failed')), created_at timestamptz not null default now()
);
alter table public.profiles enable row level security; alter table public.integrations enable row level security; alter table public.contacts enable row level security; alter table public.call_sessions enable row level security; alter table public.actions enable row level security;
create policy "profiles own" on public.profiles for all using (auth.uid() = id) with check (auth.uid() = id);
create policy "integrations own read" on public.integrations for select using (auth.uid() = user_id);
create policy "contacts own" on public.contacts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "sessions own read" on public.call_sessions for select using (auth.uid() = user_id);
create policy "actions own read" on public.actions for select using (auth.uid() = user_id);
