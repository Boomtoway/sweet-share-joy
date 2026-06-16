
DO $$ BEGIN
  CREATE TYPE public.subscription_plan AS ENUM ('starter','growth','agency');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.subscription_status AS ENUM ('active','expired','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  plan public.subscription_plan NOT NULL,
  status public.subscription_status NOT NULL DEFAULT 'active',
  price_lkr INTEGER NOT NULL,
  start_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  expiry_date TIMESTAMPTZ,
  max_bots INTEGER,
  max_messages INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_subscriptions_client ON public.subscriptions(client_id);
CREATE INDEX idx_subscriptions_status ON public.subscriptions(status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all subscriptions"
ON public.subscriptions FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Clients view their own subscription"
ON public.subscriptions FOR SELECT
TO authenticated
USING (client_id = auth.uid());

CREATE TRIGGER set_subscriptions_updated_at
BEFORE UPDATE ON public.subscriptions
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.subscription_plan_defaults(_plan public.subscription_plan)
RETURNS TABLE(price_lkr INTEGER, max_bots INTEGER, max_messages INTEGER)
LANGUAGE sql IMMUTABLE AS $$
  SELECT t.price_lkr, t.max_bots, t.max_messages
  FROM (VALUES
    ('starter'::public.subscription_plan, 9900,  1,    500),
    ('growth'::public.subscription_plan,  19900, 3,    3000),
    ('agency'::public.subscription_plan,  49900, NULL::int, NULL::int)
  ) AS t(plan, price_lkr, max_bots, max_messages)
  WHERE t.plan = _plan;
$$;
