CREATE TABLE public.lead_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE CASCADE,
  phone text NOT NULL,
  followup_type text NOT NULL,
  message text NOT NULL,
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  status text NOT NULL DEFAULT 'pending',
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_followups TO authenticated;
GRANT ALL ON public.lead_followups TO service_role;

ALTER TABLE public.lead_followups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace members access" ON public.lead_followups
  FOR ALL USING (public.owns_workspace(workspace_id))
  WITH CHECK (public.owns_workspace(workspace_id));

CREATE INDEX lead_followups_workspace_status_idx ON public.lead_followups (workspace_id, status, scheduled_at);
CREATE INDEX lead_followups_conversation_idx ON public.lead_followups (conversation_id);
CREATE UNIQUE INDEX lead_followups_dedupe_idx ON public.lead_followups (conversation_id, followup_type)
  WHERE status IN ('pending', 'sent');

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.lead_followups
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();