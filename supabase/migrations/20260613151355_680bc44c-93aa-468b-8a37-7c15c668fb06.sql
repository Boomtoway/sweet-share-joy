
ALTER TABLE public.ai_settings
  ADD COLUMN IF NOT EXISTS business_hours_only boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stop_on_human_reply boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS stop_on_human_request boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS stop_after_appointment boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS whitelist_numbers text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS blacklist_numbers text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS human_keywords text[] NOT NULL DEFAULT ARRAY['human','agent','manager','call me','stop'],
  ADD COLUMN IF NOT EXISTS daily_message_limit integer NOT NULL DEFAULT 200,
  ADD COLUMN IF NOT EXISTS min_reply_delay_seconds integer NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS max_reply_delay_seconds integer NOT NULL DEFAULT 25,
  ADD COLUMN IF NOT EXISTS spam_protection boolean NOT NULL DEFAULT true;
