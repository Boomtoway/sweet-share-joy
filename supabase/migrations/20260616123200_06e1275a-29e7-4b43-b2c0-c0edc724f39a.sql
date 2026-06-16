
-- Payment slips & renewal requests table
CREATE TABLE public.payment_slips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  type TEXT NOT NULL DEFAULT 'slip', -- 'slip' | 'renewal_request'
  storage_path TEXT,
  amount INTEGER,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_slips TO authenticated;
GRANT ALL ON public.payment_slips TO service_role;

ALTER TABLE public.payment_slips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clients view their own slips" ON public.payment_slips
  FOR SELECT TO authenticated
  USING (client_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Clients create their own slips" ON public.payment_slips
  FOR INSERT TO authenticated
  WITH CHECK (client_id = auth.uid());

CREATE POLICY "Admins update slips" ON public.payment_slips
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_payment_slips_updated
  BEFORE UPDATE ON public.payment_slips
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Storage policies for payment-slips bucket
-- Files stored under: {auth.uid()}/{filename}
CREATE POLICY "Clients upload own payment slips"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'payment-slips'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Clients read own payment slips"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'payment-slips'
    AND ((storage.foldername(name))[1] = auth.uid()::text OR public.has_role(auth.uid(),'admin'))
  );

CREATE POLICY "Clients delete own payment slips"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'payment-slips'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
