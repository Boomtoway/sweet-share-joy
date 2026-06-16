
ALTER TYPE public.lead_stage ADD VALUE IF NOT EXISTS 'negotiation';

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS follow_up_date timestamptz,
  ADD COLUMN IF NOT EXISTS stage_changed_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public.set_lead_stage_changed_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.stage IS DISTINCT FROM OLD.stage THEN
    NEW.stage_changed_at = now();
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS leads_set_stage_changed_at ON public.leads;
CREATE TRIGGER leads_set_stage_changed_at
BEFORE UPDATE ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.set_lead_stage_changed_at();
