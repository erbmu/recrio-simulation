create table if not exists public.simulation_identity_checks (
  id uuid primary key default gen_random_uuid(),
  external_simulation_id text not null,
  selfie_path text,
  id_path text,
  created_at timestamptz default now()
);

alter table public.simulation_identity_checks enable row level security;

create index if not exists idx_simulation_identity_checks_external_sim_id
  on public.simulation_identity_checks (external_simulation_id);

create policy "identity_checks_insert"
  on public.simulation_identity_checks
  for insert
  with check (external_simulation_id is not null);

create policy "identity_checks_select"
  on public.simulation_identity_checks
  for select
  using (true);
