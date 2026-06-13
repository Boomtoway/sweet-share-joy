
ALTER TABLE public.ai_settings
  ADD COLUMN IF NOT EXISTS personality text NOT NULL DEFAULT 'Friendly, confident, helpful',
  ADD COLUMN IF NOT EXISTS business_tone text NOT NULL DEFAULT 'professional and warm',
  ADD COLUMN IF NOT EXISTS sales_script text NOT NULL DEFAULT 'Greet customer, qualify need, recommend service, share price, ask for appointment.',
  ADD COLUMN IF NOT EXISTS pricing_rules text NOT NULL DEFAULT 'Share pricing only after asking the business type.',
  ADD COLUMN IF NOT EXISTS faq_answers text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS objection_handling text NOT NULL DEFAULT 'Acknowledge, empathize, provide value, ask a clarifying question.',
  ADD COLUMN IF NOT EXISTS followup_script text NOT NULL DEFAULT 'Hi {{name}}, just checking in on our last conversation. Are you ready to move forward?',
  ADD COLUMN IF NOT EXISTS closing_script text NOT NULL DEFAULT 'Great! Shall we book a quick call to finalize the details?';
