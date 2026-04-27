-- Run this in your Supabase SQL editor

create table if not exists agency_feedback (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  citizen_id  uuid not null references users(id) on delete cascade,
  agency      text not null check (agency in ('CDRRMO', 'BFP', 'PNP')),
  rating      int  not null check (rating between 1 and 5),
  feedback    text,
  barangay    text
);

alter table agency_feedback enable row level security;

create policy "Anyone can insert agency feedback"
  on agency_feedback for insert to public with check (true);

create policy "Anyone can read agency feedback"
  on agency_feedback for select to public using (true);
