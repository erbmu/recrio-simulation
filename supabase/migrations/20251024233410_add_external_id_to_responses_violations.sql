-- Add external simulation id mapping to responses and violations
ALTER TABLE public.simulation_responses
  ADD COLUMN IF NOT EXISTS external_simulation_id TEXT;

CREATE INDEX IF NOT EXISTS idx_simulation_responses_external_sim_id
  ON public.simulation_responses (external_simulation_id);

ALTER TABLE public.simulation_violations
  ADD COLUMN IF NOT EXISTS external_simulation_id TEXT;

CREATE INDEX IF NOT EXISTS idx_simulation_violations_external_sim_id
  ON public.simulation_violations (external_simulation_id);
