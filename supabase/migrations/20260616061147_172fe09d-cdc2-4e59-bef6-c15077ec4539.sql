
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS service_needed text,
  ADD COLUMN IF NOT EXISTS appointment_date date,
  ADD COLUMN IF NOT EXISTS appointment_time time,
  ADD COLUMN IF NOT EXISTS appointment_datetime timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_24h_sent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reminder_1h_sent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reminder_15m_sent boolean NOT NULL DEFAULT false;

ALTER TABLE public.appointments ALTER COLUMN title DROP NOT NULL;
ALTER TABLE public.appointments ALTER COLUMN starts_at DROP NOT NULL;

CREATE INDEX IF NOT EXISTS appointments_workspace_dt_idx ON public.appointments(workspace_id, appointment_datetime);
CREATE INDEX IF NOT EXISTS appointments_conversation_idx ON public.appointments(conversation_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.appointments TO authenticated;
GRANT ALL ON public.appointments TO service_role;
