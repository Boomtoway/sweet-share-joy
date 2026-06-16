ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS whatsapp_number text,
  ADD COLUMN IF NOT EXISTS sender_number text;

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS whatsapp_number text,
  ADD COLUMN IF NOT EXISTS sender_number text;

CREATE INDEX IF NOT EXISTS contacts_workspace_whatsapp_number_idx
  ON public.contacts (workspace_id, whatsapp_number)
  WHERE whatsapp_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS conversations_workspace_whatsapp_number_idx
  ON public.conversations (workspace_id, whatsapp_number)
  WHERE whatsapp_number IS NOT NULL;