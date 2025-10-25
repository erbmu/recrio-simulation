-- Add analysis report storage to simulations
ALTER TABLE public.simulations
  ADD COLUMN IF NOT EXISTS analysis_report JSONB,
  ADD COLUMN IF NOT EXISTS analysis_generated_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_simulations_analysis_generated_at
  ON public.simulations (analysis_generated_at);
