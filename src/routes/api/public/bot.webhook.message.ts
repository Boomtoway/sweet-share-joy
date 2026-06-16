import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { sendViaVps, extractWhatsappSendNumber, VPS_SEND_URL, VPS_TOKEN, getVpsResponseText } from "@/lib/vps/send";
import { detectAppointment } from "@/lib/appointments/detect";

const WebhookSchema = z.object({
  workspace_id: z.string().uuid(),
  secret: z.string().min(8).optional(),
  from: z.string().min(1).optional(),
  remote_jid: z.string().optional(),
  remoteJid: z.string().optional(),
  jid: z.string().optional(),
  phone: z.string().optional(),
  whatsapp_number: z.string().optional(),
  sender_number: z.string().optional(),
  contact_name: z.string().optional(),
  body: z.string().optional(),
  message: z.string().optional(),
  external_id: z.string().optional(),
}).passthrough();

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

// VPS constants now live in @/lib/vps/send

const whatsappJidPattern = /^[^@\s]+@s\.whatsapp\.net$/i;

function getPath(obj: any, path: string): unknown {
  return path.split(".").reduce((acc, key) => (acc && typeof acc === "object" ? acc[key] : undefined), obj);
}

function inboundSenderCandidates(body: z.infer<typeof WebhookSchema>): unknown[] {
  const raw: any = body;
  return [
    body.whatsapp_number,
    body.sender_number,
    getPath(raw, "key.senderPn"),
    getPath(raw, "key.remoteJidAlt"),
    getPath(raw, "key.participantPn"),
    raw.senderPn,
    raw.remoteJidAlt,
    raw.participantPn,
    body.from,
    body.phone,
    body.remote_jid,
    body.remoteJid,
    body.jid,
  ];
}

function validWhatsappJid(value: unknown): string | null {
  const jid = typeof value === "string" ? value.trim() : "";
  return whatsappJidPattern.test(jid) ? jid : null;
}

function extractWhatsappJid(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  const direct = validWhatsappJid(raw.replace(/^mailto:/i, ""));
  if (direct) return direct;
  const match = raw.match(/(?:mailto:)?([^\s<[\]()]+@s\.whatsapp\.net)/i);
  return match ? validWhatsappJid(match[1]) : null;
}

function normalizeLkPhone(value: unknown): string | null {
  let phone = typeof value === "string" ? value.trim() : "";
  phone = phone.replace(/^mailto:/i, "").split("@")[0].replace(/[^\d+]/g, "");
  if (phone.startsWith("+")) phone = phone.slice(1);
  if (phone.startsWith("00")) phone = phone.slice(2);
  if (phone.startsWith("0")) phone = `94${phone.slice(1)}`;
  return /^947\d{8}$/.test(phone) ? phone : null;
}

function normalizeLkPhoneToJid(value: unknown): string | null {
  const phone = normalizeLkPhone(value);
  return phone ? `${phone}@s.whatsapp.net` : null;
}

function jidUser(jid: string) {
  return jid.split("@")[0];
}

async function logStep(
  supabaseAdmin: any,
  workspaceId: string,
  message: string,
  metadata: Record<string, unknown> = {},
  level: "info" | "warn" | "error" = "info",
) {
  console.log(`[webhook] ${message}`, metadata);
  try {
    await supabaseAdmin.from("bot_logs").insert({
      workspace_id: workspaceId,
      bot_name: "whatsapp-vps",
      channel: "whatsapp",
      level,
      message,
      metadata,
    });
  } catch (e) {
    console.error("[webhook] log insert failed", e);
  }
}

async function timed<T>(
  supabaseAdmin: any,
  workspaceId: string,
  name: string,
  fn: () => PromiseLike<T>,
): Promise<T> {
  const t0 = Date.now();
  try {
    const r = await fn();
    const ms = Date.now() - t0;
    if (ms > 5000) {
      await logStep(
        supabaseAdmin,
        workspaceId,
        `SLOW query "${name}" took ${ms}ms`,
        { name, ms },
        "warn",
      );
    } else {
      console.log(`[webhook] ${name} ${ms}ms`);
    }
    return r;
  } catch (err: any) {
    const ms = Date.now() - t0;
    await logStep(
      supabaseAdmin,
      workspaceId,
      `Query "${name}" failed after ${ms}ms: ${err?.message}`,
      { name, ms, stack: err?.stack?.slice(0, 400) },
      "error",
    );
    throw err;
  }
}


function scheduleBackground(request: Request, work: Promise<unknown>) {
  work.catch(() => {});
  try {
    const g: any = globalThis as any;
    if (g.EdgeRuntime?.waitUntil) return g.EdgeRuntime.waitUntil(work);
  } catch {}
  try {
    (request as any).waitUntil?.(work);
  } catch {}
}

function queueLog(
  request: Request,
  supabaseAdmin: any,
  workspaceId: string,
  message: string,
  metadata: Record<string, unknown> = {},
  level: "info" | "warn" | "error" = "info",
) {
  console.log(`[webhook] ${message}`, metadata);
  scheduleBackground(
    request,
    supabaseAdmin
      .from("bot_logs")
      .insert({
        workspace_id: workspaceId,
        bot_name: "whatsapp-vps",
        channel: "whatsapp",
        level,
        message,
        metadata,
      })
      .then(() => undefined)
      .catch((e: any) => console.error("[webhook] queued log insert failed", e)),
  );
}

export const Route = createFileRoute("/api/public/bot/webhook/message")({

  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, x-bot-secret",
          },
        }),
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        let workspaceId = "unknown";
        try {
          const receivedAt = Date.now();
          const raw = await request.json();
          const body = WebhookSchema.parse(raw);
          console.log("WEBHOOK BODY:", body);
          workspaceId = body.workspace_id;
          const headerSecret = request.headers.get("x-bot-secret") ?? "";
          const rawSenderFields = {
            remote_jid: body.remote_jid,
            remoteJid: body.remoteJid,
            jid: body.jid,
            whatsapp_number: body.whatsapp_number,
            sender_number: body.sender_number,
            phone: body.phone,
            from: body.from,
            senderPn: (body as any).senderPn,
            remoteJidAlt: (body as any).remoteJidAlt,
            participantPn: (body as any).participantPn,
            key_senderPn: getPath(body, "key.senderPn"),
            key_remoteJidAlt: getPath(body, "key.remoteJidAlt"),
            key_participantPn: getPath(body, "key.participantPn"),
          };
          const rawFrom = String(body.remote_jid || body.remoteJid || body.jid || body.whatsapp_number || body.sender_number || body.phone || body.from || "");
          const inboundText = body.body ?? body.message ?? "";
          // STRICT: the phone number may only come from original WhatsApp sender fields.
          // Never derive it from conversation_id/contact_id/lead_id or previous message recipients.
          const sourcePhone = extractWhatsappSendNumber(...inboundSenderCandidates(body));
          if (!sourcePhone) {
            await logStep(supabaseAdmin, workspaceId, "INCOMING_INVALID_SENDER_NUMBER", {
              contact_id: null,
              phone: body.phone ?? body.from ?? null,
              remote_jid: body.remote_jid ?? body.remoteJid ?? body.jid ?? null,
              final_send_number: "",
              rawFrom,
              raw_sender_fields: rawSenderFields,
            }, "error");
            return new Response(JSON.stringify({ error: "Invalid WhatsApp number" }), { status: 400, headers: cors });
          }
          const remote_jid = `${sourcePhone}@s.whatsapp.net`;
          if (!validWhatsappJid(remote_jid)) {
            return new Response(JSON.stringify({ error: "No valid WhatsApp JID in payload" }), {
              status: 400,
              headers: cors,
            });
          }
          console.log("WEBHOOK BODY FROM:", body.from);
          console.log("REMOTE_JID SAVING:", remote_jid);
          console.log("REMOTE JID FOUND:", remote_jid);

          queueLog(request, supabaseAdmin, workspaceId, "Incoming Message", {
            contact_id: null,
            phone: sourcePhone,
            remote_jid,
            final_send_number: sourcePhone,
            raw_sender_fields: rawSenderFields,
            preview: inboundText.slice(0, 80),
          });

          queueLog(request, supabaseAdmin, workspaceId, "inbound_received", {
            from: body.from,
            remote_jid: body.remote_jid,
            remoteJid: body.remoteJid,
            jid: body.jid,
            source_remote_jid: remote_jid,
            extracted_whatsapp_number: sourcePhone,
            phone_before_save: rawFrom,
            preview: inboundText.slice(0, 80),
            has_x_bot_secret: Boolean(headerSecret),
          });


          // Sanity check: if a full JID was sent, its user part MUST match `from`.
          if (remote_jid) {
            const expected = jidUser(remote_jid);
            const normalizedFrom = normalizeLkPhone(rawFrom);
            if (normalizedFrom && normalizedFrom !== expected) {
              queueLog(
                request,
                supabaseAdmin,
                workspaceId,
                "phone_saved differs from remoteJid.split('@')[0]",
                { remote_jid, from: rawFrom, normalized_from: normalizedFrom, expected },
                "error",
              );
            }
          } else if (body.remote_jid) {
            queueLog(
              request,
              supabaseAdmin,
              workspaceId,
              "invalid_remote_jid_payload",
              { remote_jid: body.remote_jid, from: body.from },
              "error",
            );
          }


          const sessionRes: any = await timed(
            supabaseAdmin,
            workspaceId,
            "select whatsapp_sessions",
            () =>
              supabaseAdmin
                .from("whatsapp_sessions")
                .select("*")
                .eq("workspace_id", workspaceId)
                .single(),
          );
          const session = sessionRes?.data;
          const envSecret = process.env.WEBHOOK_SECRET;
          const providedSecret = headerSecret || body.secret || "";
          const secretOk = Boolean(
            session &&
              providedSecret &&
              (providedSecret === session.webhook_secret ||
                (envSecret && providedSecret === envSecret)),
          );
          if (!secretOk) {
            return new Response(JSON.stringify({ error: "Invalid secret" }), {
              status: 401,
              headers: cors,
            });
          }
          queueLog(request, supabaseAdmin, workspaceId, "secret_ok", {
            source: headerSecret ? "x-bot-secret" : "body.secret",
          });

          // Daily counter reset
          const today = new Date().toISOString().slice(0, 10);
          if (session.counter_date !== today) {
            await supabaseAdmin
              .from("whatsapp_sessions")
              .update({ counter_date: today, messages_today: 0 })
              .eq("id", session.id);
            session.messages_today = 0;
          }

          // Find/create contact (match by remote_jid when available, else by phone)
          const lookupQuery = supabaseAdmin
            .from("contacts")
            .select("*")
            .eq("workspace_id", workspaceId);
          const { data: contactByJid } = remote_jid
            ? await lookupQuery.eq("remote_jid", remote_jid).maybeSingle()
            : { data: null as any };
          let contact = contactByJid as any;
          if (!contact && sourcePhone) {
            const { data: contactByPhone } = await supabaseAdmin
              .from("contacts")
              .select("*")
              .eq("workspace_id", workspaceId)
              .eq("phone", sourcePhone)
              .maybeSingle();
            contact = contactByPhone;
          }
          if (!contact) {
            const ins = await supabaseAdmin
              .from("contacts")
              .insert({
                workspace_id: workspaceId,
                phone: sourcePhone,
                remote_jid,
                whatsapp_number: sourcePhone,
                sender_number: sourcePhone,
                name: body.contact_name ?? sourcePhone ?? "WhatsApp contact",
                channel: "whatsapp",
                external_id: body.external_id,
              } as any)
              .select()
              .single();
            contact = ins.data;
          } else if (remote_jid && (contact.remote_jid !== remote_jid || contact.phone !== sourcePhone || contact.whatsapp_number !== sourcePhone || contact.sender_number !== sourcePhone)) {
            // Backfill remote_jid/phone on existing contact
            await supabaseAdmin
              .from("contacts")
              .update({ remote_jid, phone: sourcePhone, whatsapp_number: sourcePhone, sender_number: sourcePhone } as any)
              .eq("id", contact.id);
            contact.remote_jid = remote_jid;
            contact.phone = sourcePhone;
            contact.whatsapp_number = sourcePhone;
            contact.sender_number = sourcePhone;
          }
          if (!contact) {
            return new Response(JSON.stringify({ error: "contact failed" }), {
              status: 500,
              headers: cors,
            });
          }

          queueLog(request, supabaseAdmin, workspaceId, "Contact resolved", {
            contact_id: contact.id,
            remote_jid: contact.remote_jid,
            phone: contact.phone,
            final_send_number: sourcePhone,
            phone_before_save: rawFrom,
          });


          // Find/create conversation. Store the exact WhatsApp JID on the conversation.
          let conv: any = null;
          if (remote_jid) {
            const byJid = await supabaseAdmin
              .from("conversations")
              .select("*")
              .eq("workspace_id", workspaceId)
              .eq("remote_jid", remote_jid)
              .maybeSingle();
            conv = byJid.data;
          }
          if (!conv) {
            const byContact = await supabaseAdmin
              .from("conversations")
              .select("*")
              .eq("workspace_id", workspaceId)
              .eq("contact_id", contact.id)
              .maybeSingle();
            conv = byContact.data;
          }
          if (!conv) {
            console.log("UPSERTING CONVERSATION:", { contact_id: contact.id, remote_jid });
            const ins = await supabaseAdmin
              .from("conversations")
              .insert({ workspace_id: workspaceId, contact_id: contact.id, remote_jid, whatsapp_number: sourcePhone, sender_number: sourcePhone } as any)
              .select()
              .single();
            conv = ins.data;
          } else if (remote_jid && (conv.remote_jid !== remote_jid || conv.whatsapp_number !== sourcePhone || conv.sender_number !== sourcePhone)) {
            console.log("UPSERTING CONVERSATION:", { contact_id: contact.id, remote_jid });
            await supabaseAdmin
              .from("conversations")
              .update({ remote_jid, whatsapp_number: sourcePhone, sender_number: sourcePhone } as any)
              .eq("id", conv.id);
            conv.remote_jid = remote_jid;
            conv.whatsapp_number = sourcePhone;
            conv.sender_number = sourcePhone;
          }
          if (!conv) {
            return new Response(JSON.stringify({ error: "conv failed" }), {
              status: 500,
              headers: cors,
            });
          }

          // Save inbound + bump conversation
          await supabaseAdmin.from("messages").insert({
            workspace_id: workspaceId,
            conversation_id: conv.id,
            direction: "inbound",
            sender: "contact",
            body: inboundText,
          });
          await supabaseAdmin
            .from("conversations")
            .update({
              last_message_at: new Date().toISOString(),
              unread_count: (conv.unread_count ?? 0) + 1,
              remote_jid,
            })
            .eq("id", conv.id);
          conv.remote_jid = remote_jid;

          // Auto-cancel pending follow-ups when the customer replies.
          const { data: cancelled } = await supabaseAdmin
            .from("lead_followups")
            .update({ status: "cancelled" })
            .eq("conversation_id", conv.id)
            .eq("status", "pending")
            .select("id, followup_type");
          if (cancelled && cancelled.length > 0) {
            queueLog(request, supabaseAdmin, workspaceId, "FOLLOWUP_AUTO_CANCELLED", {
              conversation_id: conv.id,
              count: cancelled.length,
              types: cancelled.map((c: any) => c.followup_type),
            });
          }


          queueLog(request, supabaseAdmin, workspaceId, "inbound_saved", {
            conv_id: conv.id,
            conversation_remote_jid: remote_jid,
            contact_remote_jid: contact.remote_jid ?? null,
            phone_saved: contact.phone,
          });
          queueLog(request, supabaseAdmin, workspaceId, "Save Conversation", {
            conversation_id: conv.id,
            contact_id: contact.id,
            phone: contact.phone,
            remote_jid,
            final_send_number: sourcePhone,
          });

          // ---- Run inline. Background tasks (EdgeRuntime.waitUntil /
          // request.waitUntil) do not exist in this Worker runtime, so any
          // work scheduled after Response was being dropped — the VPS send
          // never executed. Await it so the fetch actually runs. ----
          try {
            await generateAndSend({
              supabaseAdmin,
              session,
              conversation: conv,
              contact,
              workspaceId,
              inboundBody: inboundText,
              fromPhone: sourcePhone,
              remoteJid: remote_jid,
            });
          } catch (err: any) {
            await logStep(
              supabaseAdmin,
              workspaceId,
              `generateAndSend crashed: ${err?.message}`,
              { stack: err?.stack?.slice(0, 500) },
              "error",
            );
          }

          queueLog(request, supabaseAdmin, workspaceId, "http_200_returned", {
            queued: false,
            ms: Date.now() - receivedAt,
          });
          return new Response(JSON.stringify({ ok: true }), { headers: cors });
        } catch (e: any) {
          await logStep(
            supabaseAdmin,
            workspaceId,
            `Webhook failed: ${e?.message ?? "unknown"}`,
            { stack: e?.stack },
            "error",
          );
          return new Response(JSON.stringify({ error: e?.message ?? "Webhook failed" }), {
            status: 400,
            headers: cors,
          });
        }
      },
    },
  },
});

async function generateAndSend(args: {
  supabaseAdmin: any;
  session: any;
  conversation: any;
  contact: any;
  workspaceId: string;
  inboundBody: string;
  fromPhone: string | null;
  remoteJid: string | null;
}) {
  const { supabaseAdmin, session, conversation, contact, workspaceId, inboundBody, fromPhone, remoteJid } =
    args;


  try {
    await logStep(supabaseAdmin, workspaceId, "background_started", {
      conversation_id: conversation.id,
      contact_id: contact.id,
    });

    // Auto-create lead
    const { data: existingLead } = await supabaseAdmin
      .from("leads")
      .select("id")
      .eq("contact_id", contact.id)
      .maybeSingle();
    if (!existingLead) {
      await supabaseAdmin.from("leads").insert({
        workspace_id: workspaceId,
        contact_id: contact.id,
        source: "whatsapp",
        stage: "new",
      } as any);
    }

    // ---- Risk gates ----
    const blocked: string[] = [];
    if (!session.ai_enabled) blocked.push("ai_off_global");
    if (!contact.ai_enabled) blocked.push("ai_off_contact");
    if (contact.human_takeover) blocked.push("human_takeover");
    if (contact.is_blacklisted) blocked.push("blacklisted");
    if (session.list_mode === "whitelist" && !contact.is_whitelisted) blocked.push("not_whitelisted");
    if (session.list_mode === "blacklist" && contact.is_blacklisted) blocked.push("blacklisted_mode");
    if (session.messages_today >= session.daily_limit) blocked.push("daily_limit");

    if (/\b(human|agent|manager|real person|manussa|aalu|ஆள்|මනුස්ස)\b/i.test(inboundBody)) {
      await supabaseAdmin.from("contacts").update({ human_takeover: true }).eq("id", contact.id);
      blocked.push("human_requested");
    }

    if (blocked.length) {
      await logStep(
        supabaseAdmin,
        workspaceId,
        `Auto-reply blocked: ${blocked.join(", ")}`,
        { reasons: blocked },
        "warn",
      );
      await supabaseAdmin.from("risk_logs").insert({
        workspace_id: workspaceId,
        conversation_id: conversation.id,
        level: "info",
        category: "blocked",
        message: `Auto-reply blocked: ${blocked.join(", ")}`,
        metadata: { reasons: blocked },
      } as any);
      return;
    }

    // ---- Reply rules (keyword match) ----
    const { data: rules } = await supabaseAdmin
      .from("reply_rules")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("enabled", true);
    const lower = inboundBody.toLowerCase();
    const matched = (rules ?? []).find((r: any) =>
      (r.trigger_keywords ?? []).some((k: string) => k && lower.includes(k.toLowerCase())),
    );

    let replyText: string | undefined = matched?.response;
    if (replyText) {
      await logStep(supabaseAdmin, workspaceId, "Matched reply rule", {
        trigger: matched?.trigger_keywords,
      });
    }

    // ---- Gemini AI fallback (direct Google Generative Language API) ----
    if (!replyText) {
      const geminiKey = process.env.GEMINI_API_KEY;
      if (!geminiKey) {
        await logStep(supabaseAdmin, workspaceId, "GEMINI_API_KEY missing", {}, "error");
        return;
      }
      await logStep(supabaseAdmin, workspaceId, "Gemini key found", {});

      const { data: aiSettings } = await supabaseAdmin
        .from("ai_settings")
        .select("*")
        .eq("workspace_id", workspaceId)
        .single();
      if (!aiSettings) {
        await logStep(supabaseAdmin, workspaceId, "No ai_settings row", {}, "error");
        return;
      }

      const sys = `You are a professional human sales assistant for WhatsApp. Reply naturally in the customer's language (English, Tamil, or Sinhala). Keep it short. Ask one question at a time. Never reveal you are AI.\n\nPersonality: ${aiSettings.personality}\nTone: ${aiSettings.business_tone}\nSales script: ${aiSettings.sales_script}\nPricing: ${aiSettings.pricing_rules}\nFAQ: ${aiSettings.faq_answers}\nObjections: ${aiSettings.objection_handling}`;

      // Fetch the LATEST 12 messages, then put them in chronological order.
      const { data: historyDesc } = await supabaseAdmin
        .from("messages")
        .select("direction, body, created_at")
        .eq("conversation_id", conversation.id)
        .order("created_at", { ascending: false })
        .limit(12);
      const history = (historyDesc ?? []).slice().reverse();

      // Build alternating user/model turns starting with user.
      const contents: any[] = [];
      for (const m of history) {
        const role = m.direction === "inbound" ? "user" : "model";
        const text = (m.body ?? "").trim();
        if (!text) continue;
        if (contents.length === 0 && role !== "user") continue; // must start with user
        const last = contents[contents.length - 1];
        if (last && last.role === role) {
          // merge consecutive same-role turns
          last.parts[0].text += "\n" + text;
        } else {
          contents.push({ role, parts: [{ text }] });
        }
      }
      // Ensure last turn is the user's new inbound message.
      const lastTurn = contents[contents.length - 1];
      if (!lastTurn || lastTurn.role !== "user") {
        contents.push({ role: "user", parts: [{ text: inboundBody }] });
      }

      const model = "gemini-2.5-flash";
      await logStep(supabaseAdmin, workspaceId, "ai_started", {
        model,
        turns: contents.length,
        last_role: contents[contents.length - 1]?.role,
      });

      const t0 = Date.now();
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: sys }] },
            contents,
            generationConfig: {
              temperature: Number(aiSettings.temperature ?? 0.7),
              maxOutputTokens: 1024,
            },
          }),
        });
        const json: any = await res.json();
        if (!res.ok) {
          await logStep(
            supabaseAdmin,
            workspaceId,
            `Gemini HTTP ${res.status}`,
            { body: JSON.stringify(json).slice(0, 800) },
            "error",
          );
          return;
        }
        replyText = json?.candidates?.[0]?.content?.parts
          ?.map((p: any) => p.text)
          .filter(Boolean)
          .join("")
          ?.trim();
        const finishReason = json?.candidates?.[0]?.finishReason;
        await logStep(supabaseAdmin, workspaceId, "ai_completed", {
          ms: Date.now() - t0,
          length: replyText?.length ?? 0,
          model,
          finish_reason: finishReason,
          prompt_feedback: json?.promptFeedback,
          safety_ratings: json?.candidates?.[0]?.safetyRatings,
          usage: json?.usageMetadata,
        });

        if (!replyText) {
          await logStep(
            supabaseAdmin,
            workspaceId,
            `Gemini empty reply (finish=${finishReason})`,
            { raw: JSON.stringify(json).slice(0, 1200) },
            "error",
          );
        }
      } catch (err: any) {
        await logStep(
          supabaseAdmin,
          workspaceId,
          `Gemini failed: ${err?.message}`,
          { ms: Date.now() - t0, stack: err?.stack?.slice(0, 500) },
          "error",
        );
        return;
      }
    }

    if (!replyText) {
      return;
    }

    // ---- Appointment intent detection (auto-create appointment) ----
    try {
      const detected = detectAppointment(inboundBody);
      if (detected?.intent) {
        const apptPhone = contact?.phone ?? contact?.whatsapp_number ?? contact?.sender_number ?? fromPhone ?? "";
        const apptName = contact?.name ?? (apptPhone || "Customer");
        const { data: apptRow, error: apptErr } = await supabaseAdmin
          .from("appointments")
          .insert({
            workspace_id: workspaceId,
            contact_id: contact?.id ?? null,
            conversation_id: conversation.id,
            name: apptName,
            phone: apptPhone,
            service_needed: detected.service_needed,
            appointment_date: detected.date,
            appointment_time: detected.time,
            appointment_datetime: detected.datetime,
            starts_at: detected.datetime,
            title: detected.service_needed || `Appointment with ${apptName}`,
            notes: `Auto-created from message: "${inboundBody.slice(0, 200)}"`,
            status: "scheduled",
          } as any)
          .select()
          .single();
        await logStep(
          supabaseAdmin,
          workspaceId,
          apptErr ? "APPOINTMENT_CREATE_FAILED" : "APPOINTMENT_AUTO_CREATED",
          { detected, appointment_id: apptRow?.id, error: apptErr?.message },
          apptErr ? "error" : "info",
        );
      }
    } catch (apptEx: any) {
      await logStep(supabaseAdmin, workspaceId, "APPOINTMENT_DETECT_ERROR", { error: apptEx?.message }, "error");
    }

    // Save outbound as pending
    const { data: outboundMsg } = await supabaseAdmin
      .from("messages")
      .insert({
        workspace_id: workspaceId,
        conversation_id: conversation.id,
        direction: "outbound",
        sender: "ai",
        body: replyText,
        delivery_status: "pending",
      })
      .select()
      .single();
    await supabaseAdmin
      .from("whatsapp_sessions")
      .update({ messages_today: (session.messages_today ?? 0) + 1 })
      .eq("id", session.id);
    console.log("AI_REPLY_CREATED", { message_id: outboundMsg?.id, length: replyText.length });
    await logStep(supabaseAdmin, workspaceId, "AI_REPLY_CREATED", {
      length: replyText.length,
      message_id: outboundMsg?.id,
      delivery_status: "pending",
    });


    // Human-like delay
    const delaySec =
      (session.min_delay_seconds ?? 1) +
      Math.floor(
        Math.random() *
          Math.max(1, (session.max_delay_seconds ?? 3) - (session.min_delay_seconds ?? 1)),
      );
    await new Promise((r) => setTimeout(r, delaySec * 1000));

    const markFailed = async (err: string) => {
      if (!outboundMsg?.id) return;
      await supabaseAdmin
        .from("messages")
        .update({ delivery_status: "failed", delivery_error: err.slice(0, 1000) })
        .eq("id", outboundMsg.id);
    };

    // Exact AI auto-reply send target assignment:
    // verified sender-number fields → inbound remoteJid → conversation.remote_jid → contact.remote_jid → contact.phone.
    // Only real sender/JID fields are candidates; conversation_id/contact_id/lead_id
    // and message-history recipients are never used as WhatsApp numbers.
    const phone = contact?.phone ?? contact?.whatsapp_number ?? contact?.sender_number ?? fromPhone ?? "";
    const remoteJidForSend = remoteJid || conversation.remote_jid || contact?.remote_jid || "";
    const extractedWhatsappNumber = extractWhatsappSendNumber(
      conversation.whatsapp_number,
      conversation.sender_number,
      contact?.whatsapp_number,
      contact?.sender_number,
      fromPhone,
      remoteJid,
      conversation.remote_jid,
      contact?.remote_jid,
      contact?.phone,
    );
    const to = extractedWhatsappNumber;
    await logStep(supabaseAdmin, workspaceId, "AI Generation", {
      conversation_id: conversation.id,
      contact_id: contact.id,
      phone,
      remote_jid: remoteJidForSend,
      final_send_number: to,
      message_id: outboundMsg?.id,
    });
    console.log("SEND_TO_NUMBER", {
      conversation_id: conversation.id,
      contact_id: contact.id,
      phone,
      remote_jid: remoteJidForSend,
      extracted_whatsapp_number: extractedWhatsappNumber,
      final_send_number: to,
    });
    await logStep(supabaseAdmin, workspaceId, "SEND_TO_NUMBER", {
      conversation_id: conversation.id,
      contact_id: contact.id,
      phone,
      remote_jid: remoteJidForSend,
      extracted_whatsapp_number: extractedWhatsappNumber,
      final_send_number: to,
      conversation_remote_jid: conversation.remote_jid,
      contact_remote_jid: contact?.remote_jid,
      contact_phone: contact?.phone,
      inbound_remote_jid: remoteJid,
    });

    // Strict validation: must start with 94 AND be 10–15 digits.
    const isValid = /^947\d{8}$/.test(to);
    if (!to || !isValid) {
      const err = `Invalid WhatsApp number: ${to || "(empty)"}`;
      await logStep(
        supabaseAdmin,
        workspaceId,
        "VPS_ERROR",
        { error: err, conversation_id: conversation.id, contact_id: contact.id, phone, remote_jid: remoteJidForSend, extracted_whatsapp_number: extractedWhatsappNumber, final_send_number: to, message_id: outboundMsg?.id },
        "error",
      );
      await markFailed(err);
      return;
    }

    if (outboundMsg?.id) {
      await supabaseAdmin.from("messages").update({ target_jid: to }).eq("id", outboundMsg.id);
    }

    console.log("SEND_TO_VPS", { url: VPS_SEND_URL, to, message_id: outboundMsg?.id });
    const requestHeaders = { Authorization: `Bearer ${VPS_TOKEN}`, "Content-Type": "application/json" };
    const requestBody = JSON.stringify({ to, message: replyText });
    await logStep(supabaseAdmin, workspaceId, "SEND_TO_VPS", {
      url: VPS_SEND_URL,
      to,
      message: replyText,
      message_id: outboundMsg?.id,
    });
    await logStep(supabaseAdmin, workspaceId, "VPS Send Request", {
      contact_id: contact.id,
      phone,
      remote_jid: remoteJidForSend,
      final_send_number: to,
      url: VPS_SEND_URL,
      message_id: outboundMsg?.id,
    });
    await logStep(supabaseAdmin, workspaceId, "VPS_URL", { url: VPS_SEND_URL, message_id: outboundMsg?.id });
    await logStep(supabaseAdmin, workspaceId, "REQUEST_HEADERS", { headers: requestHeaders, message_id: outboundMsg?.id });
    await logStep(supabaseAdmin, workspaceId, "REQUEST_BODY", { body: requestBody, message_id: outboundMsg?.id });

    const result = await sendViaVps(to, replyText);
    const responseText = getVpsResponseText(result);
    const debugStr = `HTTP ${result.status} ${responseText}`;

    console.log("VPS_RESPONSE", { status: result.status, ok: result.ok, body: result.body });
    await logStep(
      supabaseAdmin,
      workspaceId,
      "WhatsApp Delivery Result",
      { contact_id: contact.id, phone, remote_jid: remoteJidForSend, final_send_number: to, status: result.status, ok: result.ok, body: responseText, message_id: outboundMsg?.id },
      result.ok ? "info" : "error",
    );
    await logStep(
      supabaseAdmin,
      workspaceId,
      "RESPONSE_STATUS",
      { status: result.status, ok: result.ok, message_id: outboundMsg?.id },
      result.ok ? "info" : "error",
    );
    await logStep(
      supabaseAdmin,
      workspaceId,
      "RESPONSE_BODY",
      { body: responseText, parsed_body: result.body, message_id: outboundMsg?.id },
      result.ok ? "info" : "error",
    );
    await logStep(
      supabaseAdmin,
      workspaceId,
      "VPS_RESPONSE",
      {
        status: result.status,
        ok: result.ok,
        body: responseText,
        parsed_body: result.body,
        to,
        message_id: outboundMsg?.id,
      },
      result.ok ? "info" : "error",
    );

    if (result.ok) {
      if (outboundMsg?.id) {
        await supabaseAdmin
          .from("messages")
          .update({
            delivery_status: "sent",
            provider_message_id: result.body?.id ?? null,
            delivered_at: new Date().toISOString(),
            delivery_error: debugStr.slice(0, 1000),
          })
          .eq("id", outboundMsg.id);
      }
    } else {
      await logStep(
        supabaseAdmin,
        workspaceId,
        "VPS_ERROR",
        {
          status: result.status,
          error: responseText,
          to,
          message_id: outboundMsg?.id,
        },
        "error",
      );
      await markFailed(debugStr);
    }


  } catch (e: any) {
    await logStep(
      supabaseAdmin,
      workspaceId,
      `Background worker error: ${e?.message}`,
      { stack: e?.stack?.slice(0, 500) },
      "error",
    );
  }
}
