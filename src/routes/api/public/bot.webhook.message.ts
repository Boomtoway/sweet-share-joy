import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const WebhookSchema = z.object({
  workspace_id: z.string().uuid(),
  secret: z.string().min(8),
  from: z.string().min(1),
  contact_name: z.string().optional(),
  body: z.string().default(""),
  external_id: z.string().optional(),
});

export const Route = createFileRoute("/api/public/bot/webhook/message")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        }),
      POST: async ({ request }) => {
        const cors = {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json",
        };
        try {
          const body = WebhookSchema.parse(await request.json());
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const { data: session } = await supabaseAdmin
            .from("whatsapp_sessions")
            .select("*")
            .eq("workspace_id", body.workspace_id)
            .single();
          if (!session || session.webhook_secret !== body.secret) {
            return new Response(JSON.stringify({ error: "Invalid secret" }), { status: 401, headers: cors });
          }

          // Daily counter reset
          const today = new Date().toISOString().slice(0, 10);
          if (session.counter_date !== today) {
            await supabaseAdmin
              .from("whatsapp_sessions")
              .update({ counter_date: today, messages_today: 0 })
              .eq("id", session.id);
            session.messages_today = 0;
          }

          // Find/create contact
          let { data: contact } = await supabaseAdmin
            .from("contacts")
            .select("*")
            .eq("workspace_id", body.workspace_id)
            .eq("phone", body.from)
            .maybeSingle();
          if (!contact) {
            const ins = await supabaseAdmin
              .from("contacts")
              .insert({
                workspace_id: body.workspace_id,
                phone: body.from,
                name: body.contact_name ?? body.from,
                channel: "whatsapp",
                external_id: body.external_id,
              })
              .select()
              .single();
            contact = ins.data;
          }
          if (!contact) {
            return new Response(JSON.stringify({ error: "contact failed" }), { status: 500, headers: cors });
          }

          // Auto-create lead for new contact
          const { data: existingLead } = await supabaseAdmin
            .from("leads")
            .select("id")
            .eq("contact_id", contact.id)
            .maybeSingle();
          if (!existingLead) {
            await supabaseAdmin.from("leads").insert({
              workspace_id: body.workspace_id,
              contact_id: contact.id,
              source: "whatsapp",
              stage: "new",
            } as any);
          }

          // Find/create conversation
          let { data: conv } = await supabaseAdmin
            .from("conversations")
            .select("*")
            .eq("workspace_id", body.workspace_id)
            .eq("contact_id", contact.id)
            .maybeSingle();
          if (!conv) {
            const ins = await supabaseAdmin
              .from("conversations")
              .insert({ workspace_id: body.workspace_id, contact_id: contact.id })
              .select()
              .single();
            conv = ins.data;
          }
          if (!conv) {
            return new Response(JSON.stringify({ error: "conv failed" }), { status: 500, headers: cors });
          }

          // Save inbound
          await supabaseAdmin.from("messages").insert({
            workspace_id: body.workspace_id,
            conversation_id: conv.id,
            direction: "inbound",
            sender: "contact",
            body: body.body,
          });
          await supabaseAdmin
            .from("conversations")
            .update({ last_message_at: new Date().toISOString(), unread_count: (conv.unread_count ?? 0) + 1 })
            .eq("id", conv.id);

          // ---- Risk control gates ----
          const blocked: string[] = [];
          if (!session.ai_enabled) blocked.push("ai_off_global");
          if (!contact.ai_enabled) blocked.push("ai_off_contact");
          if (contact.human_takeover) blocked.push("human_takeover");
          if (contact.is_blacklisted) blocked.push("blacklisted");
          if (session.list_mode === "whitelist" && !contact.is_whitelisted) blocked.push("not_whitelisted");
          if (session.list_mode === "blacklist" && contact.is_blacklisted) blocked.push("blacklisted_mode");
          if (session.messages_today >= session.daily_limit) blocked.push("daily_limit");

          // Customer asks for human
          if (/\b(human|agent|manager|real person|manussa|aalu|ஆள்|මනුස්ස)\b/i.test(body.body)) {
            await supabaseAdmin.from("contacts").update({ human_takeover: true }).eq("id", contact.id);
            blocked.push("human_requested");
          }

          if (blocked.length) {
            await supabaseAdmin.from("risk_logs").insert({
              workspace_id: body.workspace_id,
              conversation_id: conv.id,
              level: "info",
              category: "blocked",
              message: `Auto-reply blocked: ${blocked.join(", ")}`,
              metadata: { reasons: blocked },
            } as any);
            return new Response(JSON.stringify({ ok: true, replied: false, reasons: blocked }), { headers: cors });
          }

          // ---- Reply rules (keyword match) ----
          const { data: rules } = await supabaseAdmin
            .from("reply_rules")
            .select("*")
            .eq("workspace_id", body.workspace_id)
            .eq("enabled", true);
          const lower = body.body.toLowerCase();
          const matched = (rules ?? []).find((r: any) =>
            (r.trigger_keywords ?? []).some((k: string) => k && lower.includes(k.toLowerCase())),
          );

          let replyText = matched?.response as string | undefined;

          // ---- Gemini AI reply ----
          if (!replyText) {
            try {
              const { generateSalesReply } = await import("@/lib/ai/sales-agent.functions");
              // Direct invoke needs auth — instead inline a minimal Gemini call:
              const { createLovableAiGatewayProvider } = await import("@/lib/ai/gateway.server");
              const { generateText } = await import("ai");
              const { data: aiSettings } = await supabaseAdmin
                .from("ai_settings")
                .select("*")
                .eq("workspace_id", body.workspace_id)
                .single();
              if (aiSettings) {
                const key = process.env.LOVABLE_API_KEY!;
                const gateway = createLovableAiGatewayProvider(key);
                const sys = `You are a professional human sales assistant for WhatsApp. Reply naturally in the customer's language (English, Tamil, or Sinhala). Keep it short. Ask one question at a time. Never reveal you are AI.\n\nPersonality: ${aiSettings.personality}\nTone: ${aiSettings.business_tone}\nSales script: ${aiSettings.sales_script}\nPricing: ${aiSettings.pricing_rules}\nFAQ: ${aiSettings.faq_answers}\nObjections: ${aiSettings.objection_handling}`;
                const { data: history } = await supabaseAdmin
                  .from("messages")
                  .select("direction, body")
                  .eq("conversation_id", conv.id)
                  .order("created_at", { ascending: true })
                  .limit(10);
                const msgs = (history ?? []).map((m: any) => ({
                  role: m.direction === "inbound" ? ("user" as const) : ("assistant" as const),
                  content: m.body ?? "",
                }));
                const r = await generateText({
                  model: gateway(aiSettings.model),
                  system: sys,
                  messages: msgs,
                  temperature: Number(aiSettings.temperature),
                });
                replyText = r.text.trim();
              }
              void generateSalesReply;
            } catch (err: any) {
              await supabaseAdmin.from("bot_logs").insert({
                workspace_id: body.workspace_id,
                bot_name: "gemini",
                channel: "whatsapp",
                level: "error",
                message: `Gemini failed: ${err.message}`,
                metadata: {},
              });
            }
          }

          if (!replyText) {
            return new Response(JSON.stringify({ ok: true, replied: false }), { headers: cors });
          }

          // Save outbound
          await supabaseAdmin.from("messages").insert({
            workspace_id: body.workspace_id,
            conversation_id: conv.id,
            direction: "outbound",
            sender: "ai",
            body: replyText,
          });
          await supabaseAdmin
            .from("whatsapp_sessions")
            .update({ messages_today: session.messages_today + 1 })
            .eq("id", session.id);

          const delay =
            session.min_delay_seconds +
            Math.floor(Math.random() * Math.max(1, session.max_delay_seconds - session.min_delay_seconds));

          return new Response(
            JSON.stringify({ ok: true, replied: true, reply: replyText, delay_seconds: delay }),
            { headers: cors },
          );
        } catch (e: any) {
          return new Response(JSON.stringify({ error: e.message ?? "Webhook failed" }), {
            status: 400,
            headers: cors,
          });
        }
      },
    },
  },
});
