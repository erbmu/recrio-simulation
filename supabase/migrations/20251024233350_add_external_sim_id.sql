-- Store the ATS simulation identifier alongside Supabase simulations
ALTER TABLE public.simulations
  ADD COLUMN IF NOT EXISTS external_simulation_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_simulations_external_simulation_id
  ON public.simulations (external_simulation_id)
  WHERE external_simulation_id IS NOT NULL;
