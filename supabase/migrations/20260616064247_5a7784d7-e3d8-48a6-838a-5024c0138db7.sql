ALTER TABLE public.ai_settings
  ADD COLUMN IF NOT EXISTS followup_test_mode boolean NOT NULL DEFAULT false;