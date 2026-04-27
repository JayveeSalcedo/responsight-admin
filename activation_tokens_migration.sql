-- Run this in your Supabase SQL editor
-- Creates the activation_tokens table used to verify responder accounts via email

create table if not exists public.activation_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  token      text not null unique,
  expires_at timestamptz not null,
  used       boolean not null default false,
  created_at timestamptz not null default now(),
  constraint activation_tokens_user_id_unique unique (user_id)
);

-- Index for fast token lookups
create index if not exists idx_activation_tokens_token on public.activation_tokens(token);

-- Allow the service role (used by API routes) full access
-- RLS is intentionally disabled — only server-side code touches this table
alter table public.activation_tokens disable row level security;
