
DO $$ BEGIN
  CREATE TYPE public.payment_request_status AS ENUM ('pending','approved','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.payment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
  subscription_id uuid REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  amount numeric(12,2) NOT NULL,
  reference_number text NOT NULL,
  bank_name text NOT NULL,
  slip_path text NOT NULL,
  note text,
  status public.payment_request_status NOT NULL DEFAULT 'pending',
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_requests TO authenticated;
GRANT ALL ON public.payment_requests TO service_role;

ALTER TABLE public.payment_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clients view own payment requests"
  ON public.payment_requests FOR SELECT TO authenticated
  USING (client_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

CREATE POLICY "Clients create own payment requests"
  ON public.payment_requests FOR INSERT TO authenticated
  WITH CHECK (client_id = auth.uid());

CREATE POLICY "Admins update payment requests"
  ON public.payment_requests FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE POLICY "Admins delete payment requests"
  ON public.payment_requests FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

CREATE TRIGGER trg_payment_requests_updated_at
  BEFORE UPDATE ON public.payment_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_payment_requests_client ON public.payment_requests(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_requests_status ON public.payment_requests(status, created_at DESC);
