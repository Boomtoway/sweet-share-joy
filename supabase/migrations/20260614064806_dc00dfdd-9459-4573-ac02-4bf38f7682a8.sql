ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS remote_jid text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS target_jid text;