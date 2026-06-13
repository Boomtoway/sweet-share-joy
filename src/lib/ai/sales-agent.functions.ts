import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generateText, Output } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "./gateway.server";

const InputSchema = z.object({
  message: z.string().min(1),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
    .optional()
    .default([]),
  channel: z.enum(["whatsapp", "messenger", "instagram", "web"]).optional().default("web"),
  contact: z
    .object({
      name: z.string().optional(),
      phone: z.string().optional(),
    })
    .optional(),
});

const LeadOutput = z.object({
  reply: z.string().describe("The natural-sounding reply to send to the customer, in their language."),
  detected_language: z.enum(["en", "ta", "si"]).describe("Detected customer language."),
  needs_human: z.boolean().describe("True if customer is angry or explicitly asks for a human."),
  lead: z.object({
    name: z.string().nullable(),
    business_name: z.string().nullable(),
    service_interest: z.string().nullable(),
    budget: z.string().nullable(),
    location: z.string().nullable(),
    urgency: z.enum(["low", "medium", "high"]).nullable(),
    phone_number: z.string().nullable(),
    appointment_time: z.string().nullable(),
    lead_score: z.number().min(0).max(100),
  }),
});

function buildSystemPrompt(s: {
  personality: string;
  business_tone: string;
  sales_script: string;
  pricing_rules: string;
  faq_answers: string;
  objection_handling: string;
  followup_script: string;
  closing_script: string;
}) {
  return `You are a professional human sales assistant for WhatsApp, Facebook Messenger, and Instagram DM. Reply like a real human salesperson — never mention that you are an AI unless directly asked.

# Personality
${s.personality}

# Tone
${s.business_tone}

# Language rules
- Detect if the customer is writing Tamil, Sinhala, or English.
- Reply in the SAME language. Use natural script (தமிழ் / සිංහල / English).
- Keep replies short, warm, and human. Ask ONLY ONE question at a time.

# Sales script
${s.sales_script}

# Pricing rules
${s.pricing_rules}
When a customer asks price: explain clearly, then ask their business type before recommending a plan.

# Objection handling
${s.objection_handling}

# FAQ
${s.faq_answers}

# Follow-up template
${s.followup_script}

# Closing
${s.closing_script}

# Escalation
- If the customer sounds angry or frustrated: apologize sincerely and set needs_human = true.
- If they ask for a human/agent/manager: set needs_human = true.

# Lead capture
Quietly extract: name, business_name, service_interest, budget, location, urgency, phone_number, appointment_time.
Score the lead 0-100 based on intent, budget clarity, and urgency.

Return ONLY the structured output.`;
}

export const generateSalesReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    const { data: profile } = await context.supabase
      .from("profiles")
      .select("workspace_id")
      .eq("id", context.userId)
      .single();
    if (!profile?.workspace_id) throw new Error("Workspace not found");

    const { data: settings, error } = await context.supabase
      .from("ai_settings")
      .select("*")
      .eq("workspace_id", profile.workspace_id)
      .single();
    if (error || !settings) throw new Error("AI settings not found");

    if (!settings.enabled) {
      return {
        reply: "",
        detected_language: "en" as const,
        needs_human: true,
        lead: {
          name: null,
          business_name: null,
          service_interest: null,
          budget: null,
          location: null,
          urgency: null,
          phone_number: data.contact?.phone ?? null,
          appointment_time: null,
          lead_score: 0,
        },
        disabled: true,
      };
    }

    const gateway = createLovableAiGatewayProvider(key);
    const model = gateway(settings.model || "google/gemini-3-flash-preview");

    const messages = [
      ...data.history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: data.message },
    ];

    const result = await generateText({
      model,
      system: buildSystemPrompt(settings),
      messages,
      temperature: Number(settings.temperature ?? 0.7),
      experimental_output: Output.object({ schema: LeadOutput }),
    });

    return { ...result.experimental_output, channel: data.channel };
  });

const SettingsSchema = z.object({
  personality: z.string(),
  business_tone: z.string(),
  sales_script: z.string(),
  pricing_rules: z.string(),
  faq_answers: z.string(),
  objection_handling: z.string(),
  followup_script: z.string(),
  closing_script: z.string(),
  tone: z.string().optional(),
  language: z.string().optional(),
  model: z.string().optional(),
  temperature: z.number().optional(),
  enabled: z.boolean().optional(),
  auto_reply: z.boolean().optional(),
});

export const getAiSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("workspace_id")
      .eq("id", context.userId)
      .single();
    if (!profile?.workspace_id) throw new Error("Workspace not found");
    const { data, error } = await context.supabase
      .from("ai_settings")
      .select("*")
      .eq("workspace_id", profile.workspace_id)
      .single();
    if (error) throw error;
    return data;
  });

export const updateAiSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SettingsSchema.partial().parse(input))
  .handler(async ({ data, context }) => {
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("workspace_id")
      .eq("id", context.userId)
      .single();
    if (!profile?.workspace_id) throw new Error("Workspace not found");
    const { data: updated, error } = await context.supabase
      .from("ai_settings")
      .update(data)
      .eq("workspace_id", profile.workspace_id)
      .select()
      .single();
    if (error) throw error;
    return updated;
  });
