DO $$ BEGIN
  CREATE TYPE public.message_delivery_status AS ENUM ('pending','sent','delivered','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS delivery_status public.message_delivery_status,
  ADD COLUMN IF NOT EXISTS delivery_error text,
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz;