-- Make RLS policies and trigger creation idempotent

-- simulations — policies
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='simulations' AND policyname='Anyone can view simulations'
  ) THEN
    CREATE POLICY "Anyone can view simulations" ON public.simulations FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='simulations' AND policyname='Anyone can create simulations'
  ) THEN
    CREATE POLICY "Anyone can create simulations" ON public.simulations FOR INSERT WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='simulations' AND policyname='Anyone can update simulations'
  ) THEN
    CREATE POLICY "Anyone can update simulations" ON public.simulations FOR UPDATE USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='simulations' AND policyname='Anyone can delete simulations'
  ) THEN
    CREATE POLICY "Anyone can delete simulations" ON public.simulations FOR DELETE USING (true);
  END IF;
END$$;

-- simulation_responses — policies
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='simulation_responses' AND policyname='Anyone can view responses'
  ) THEN
    CREATE POLICY "Anyone can view responses" ON public.simulation_responses FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='simulation_responses' AND policyname='Anyone can create responses'
  ) THEN
    CREATE POLICY "Anyone can create responses" ON public.simulation_responses FOR INSERT WITH CHECK (true);
  END IF;
END$$;

-- simulation_violations — policies
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='simulation_violations' AND policyname='Anyone can view violations'
  ) THEN
    CREATE POLICY "Anyone can view violations" ON public.simulation_violations FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='simulation_violations' AND policyname='Anyone can create violations'
  ) THEN
    CREATE POLICY "Anyone can create violations" ON public.simulation_violations FOR INSERT WITH CHECK (true);
  END IF;
END$$;

-- trigger: on_violation_insert (create only if missing)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'on_violation_insert'
  ) THEN
    CREATE TRIGGER on_violation_insert
      AFTER INSERT ON public.simulation_violations
      FOR EACH ROW
      EXECUTE FUNCTION public.increment_simulation_violations();
  END IF;
END$$;

-- (re-)enable RLS safely (harmless if already enabled)
ALTER TABLE public.simulations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.simulation_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.simulation_violations ENABLE ROW LEVEL SECURITY;
