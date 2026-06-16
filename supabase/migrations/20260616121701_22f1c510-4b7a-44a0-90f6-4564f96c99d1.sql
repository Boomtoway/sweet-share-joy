
CREATE OR REPLACE FUNCTION public.subscription_plan_defaults(_plan public.subscription_plan)
RETURNS TABLE(price_lkr INTEGER, max_bots INTEGER, max_messages INTEGER)
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT t.price_lkr, t.max_bots, t.max_messages
  FROM (VALUES
    ('starter'::public.subscription_plan, 9900,  1,    500),
    ('growth'::public.subscription_plan,  19900, 3,    3000),
    ('agency'::public.subscription_plan,  49900, NULL::int, NULL::int)
  ) AS t(plan, price_lkr, max_bots, max_messages)
  WHERE t.plan = _plan;
$$;
