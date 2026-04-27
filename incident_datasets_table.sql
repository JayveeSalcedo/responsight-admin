-- ═══════════════════════════════════════════════════════════════════
-- incident_datasets — stores uploaded CSV data for the Analytics
-- Dataset tab. Each row represents one location×year×type entry.
-- Run this in your Supabase SQL editor.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists incident_datasets (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),

  -- Which incident type this row belongs to
  incident_type  text not null check (incident_type in ('fire','flood','accident','medical','crime','other')),

  -- Year as text (e.g. '2022', '2023')
  year           text not null,

  -- Location name exactly as parsed from the CSV (e.g. 'Anonas', 'San Vicente', 'Bypass', 'Dagupan City')
  location       text not null,

  -- Monthly counts (Jan–Dec)
  jan  integer not null default 0,
  feb  integer not null default 0,
  mar  integer not null default 0,
  apr  integer not null default 0,
  may  integer not null default 0,
  jun  integer not null default 0,
  jul  integer not null default 0,
  aug  integer not null default 0,
  sep  integer not null default 0,
  oct  integer not null default 0,
  nov  integer not null default 0,
  dec  integer not null default 0,

  -- Computed total (sum of jan–dec) — stored for fast querying
  total          integer not null default 0,

  -- Prevent exact duplicate rows (same type + year + location)
  unique (incident_type, year, location)
);

-- Index for the most common query pattern in the DatasetTab
create index if not exists idx_incident_datasets_type_year
  on incident_datasets (incident_type, year);

-- ── Row Level Security ────────────────────────────────────────────

alter table incident_datasets enable row level security;

-- Allow anyone (admin panel uses anon key) to read datasets
create policy "Anyone can read incident datasets"
  on incident_datasets for select to public using (true);

-- Allow anyone to insert (admin panel uploads CSVs)
create policy "Anyone can insert incident datasets"
  on incident_datasets for insert to public with check (true);

-- Allow anyone to delete (clearing old uploads)
create policy "Anyone can delete incident datasets"
  on incident_datasets for delete to public using (true);
