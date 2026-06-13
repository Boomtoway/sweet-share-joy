
ALTER TABLE public.whatsapp_sessions
  ADD COLUMN IF NOT EXISTS vps_api_token text,
  ADD COLUMN IF NOT EXISTS webhook_secret text NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  ADD COLUMN IF NOT EXISTS daily_limit integer NOT NULL DEFAULT 200,
  ADD COLUMN IF NOT EXISTS min_delay_seconds integer NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS max_delay_seconds integer NOT NULL DEFAULT 25,
  ADD COLUMN IF NOT EXISTS ai_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS list_mode text NOT NULL DEFAULT 'off',
  ADD COLUMN IF NOT EXISTS facebook_lead_only boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS messages_today integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS counter_date date NOT NULL DEFAULT current_date;

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS ai_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_whitelisted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_blacklisted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS human_takeover boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS bot_logs_workspace_created_idx ON public.bot_logs (workspace_id, created_at DESC);
