
DO $$ BEGIN
  CREATE TYPE public.invoice_status AS ENUM ('draft','sent','partially_paid','paid','overdue');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  customer_name text,
  phone text,
  service text,
  invoice_number text NOT NULL,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  paid_amount numeric(14,2) NOT NULL DEFAULT 0,
  balance_amount numeric(14,2) NOT NULL DEFAULT 0,
  status public.invoice_status NOT NULL DEFAULT 'draft',
  due_date date,
  notes text,
  sent_at timestamptz,
  paid_at timestamptz,
  last_reminder_at timestamptz,
  reminder_stage text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, invoice_number)
);

CREATE INDEX IF NOT EXISTS invoices_workspace_idx ON public.invoices(workspace_id);
CREATE INDEX IF NOT EXISTS invoices_lead_idx ON public.invoices(lead_id);
CREATE INDEX IF NOT EXISTS invoices_status_idx ON public.invoices(status);
CREATE INDEX IF NOT EXISTS invoices_due_idx ON public.invoices(due_date);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoices TO authenticated;
GRANT ALL ON public.invoices TO service_role;

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Workspace owners manage invoices"
  ON public.invoices
  FOR ALL
  TO authenticated
  USING (public.owns_workspace(workspace_id))
  WITH CHECK (public.owns_workspace(workspace_id));

CREATE OR REPLACE FUNCTION public.set_invoice_balance()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.balance_amount := COALESCE(NEW.amount,0) - COALESCE(NEW.paid_amount,0);
  IF NEW.status <> 'draft' AND NEW.due_date IS NOT NULL AND NEW.due_date < CURRENT_DATE
     AND NEW.balance_amount > 0 AND NEW.status NOT IN ('paid') THEN
    NEW.status := 'overdue';
  END IF;
  IF NEW.paid_amount > 0 AND NEW.paid_amount < NEW.amount AND NEW.status NOT IN ('overdue','paid') THEN
    NEW.status := 'partially_paid';
  END IF;
  IF NEW.amount > 0 AND NEW.paid_amount >= NEW.amount THEN
    NEW.status := 'paid';
    IF NEW.paid_at IS NULL THEN NEW.paid_at := now(); END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_invoice_balance ON public.invoices;
CREATE TRIGGER trg_invoice_balance
  BEFORE INSERT OR UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.set_invoice_balance();
