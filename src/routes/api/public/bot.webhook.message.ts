import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const WebhookSchema = z.object({
  workspace_id: z.string().uuid(),
  secret: z.string().min(8).optional(),
  from: z.string().min(1).optional(),
  remote_jid: z.string().optional(),
  remoteJid: z.string().optional(),
  jid: z.string().optional(),
  phone: z.string().optional(),
  contact_name: z.string().optional(),
  body: z.string().optional(),
  message: z.string().optional(),
  external_id: z.string().optional(),
}).passthrough();

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

const DIRECT_VPS_SEND_URL = "https://bot.statapplkmarketing.shop/send";
const DIRECT_VPS_TOKEN = "startapplk-bot-12345";
const TEST_VPS_RECIPIENT = "94740123466";
const BLOCKED_RECIPIENTS = new Set(["27771812204615"]);

function normalizeJid(value: unknown): string | null {
  if (!value) return null;
  const digits = String(value).replace(/\D/g, "");
  return digits ? `${digits}@s.whatsapp.net` : null;
}

function pickVpsRecipientJid(conversation: any, contact: any, fallbackJid?: string | null): string {
  const candidates = [conversation?.remote_jid, contact?.remote_jid, contact?.phone, fallbackJid];
  for (const c of candidates) {
    const jid = normalizeJid(c);
    if (!jid) continue;
    const digits = jid.split("@")[0];
    if (BLOCKED_RECIPIENTS.has(digits)) continue;
    return jid;
  }
  return `${TEST_VPS_RECIPIENT}@s.whatsapp.net`;
}

const whatsappJidPattern = /^[^@\s]+@s\.whatsapp\.net$/i;

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
  return /^94\d{9}$/.test(phone) ? phone : null;
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
          const rawFrom = String(body.from || body.remote_jid || body.jid || "");
          const inboundText = body.body ?? body.message ?? "";
          const digits = rawFrom.replace(/\D/g, "");
          const remote_jid = rawFrom.includes("@s.whatsapp.net")
            ? rawFrom
            : `${digits.startsWith("0") ? "94" + digits.slice(1) : digits}@s.whatsapp.net`;
          const sourcePhone = remote_jid.replace("@s.whatsapp.net", "");
          if (!validWhatsappJid(remote_jid)) {
            return new Response(JSON.stringify({ error: "No valid WhatsApp JID in payload" }), {
              status: 400,
              headers: cors,
            });
          }
          console.log("WEBHOOK BODY FROM:", body.from);
          console.log("REMOTE_JID SAVING:", remote_jid);
          console.log("REMOTE JID FOUND:", remote_jid);

          queueLog(request, supabaseAdmin, workspaceId, "inbound_received", {
            from: body.from,
            remote_jid: body.remote_jid,
            remoteJid: body.remoteJid,
            jid: body.jid,
            source_remote_jid: remote_jid,
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
                name: body.contact_name ?? sourcePhone ?? "WhatsApp contact",
                channel: "whatsapp",
                external_id: body.external_id,
              })
              .select()
              .single();
            contact = ins.data;
          } else if (remote_jid && (contact.remote_jid !== remote_jid || contact.phone !== sourcePhone)) {
            // Backfill remote_jid/phone on existing contact
            await supabaseAdmin
              .from("contacts")
              .update({ remote_jid, phone: sourcePhone })
              .eq("id", contact.id);
            contact.remote_jid = remote_jid;
            contact.phone = sourcePhone;
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
            phone_saved: contact.phone,
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
              .insert({ workspace_id: workspaceId, contact_id: contact.id, remote_jid })
              .select()
              .single();
            conv = ins.data;
          } else if (remote_jid && conv.remote_jid !== remote_jid) {
            console.log("UPSERTING CONVERSATION:", { contact_id: contact.id, remote_jid });
            await supabaseAdmin
              .from("conversations")
              .update({ remote_jid })
              .eq("id", conv.id);
            conv.remote_jid = remote_jid;
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

          queueLog(request, supabaseAdmin, workspaceId, "inbound_saved", {
            conv_id: conv.id,
            conversation_remote_jid: remote_jid,
            contact_remote_jid: contact.remote_jid ?? null,
            phone_saved: contact.phone,
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

    // Direct VPS send — mirror the working "Test VPS Send" fetch.
    const to = pickVpsRecipient(conversation, contact);
    console.log("AI REPLY:", replyText);
    if (outboundMsg?.id) {
      await supabaseAdmin
        .from("messages")
        .update({ target_jid: to })
        .eq("id", outboundMsg.id);
    }
    const url = DIRECT_VPS_SEND_URL;
    const payload = { to, message: replyText };
    console.log("CALLING_VPS_SEND", { url, to, message_id: outboundMsg?.id });
    console.log("START_SEND", { message_id: outboundMsg?.id });
    console.log("SEND_URL", url);
    console.log("SEND_TO", to);
    console.log("SEND_MESSAGE", replyText);
    await logStep(supabaseAdmin, workspaceId, "CALLING_VPS_SEND", {
      url,
      to,
      message: replyText,
      message_id: outboundMsg?.id,
      conversation_remote_jid: conversation.remote_jid,
      contact_remote_jid: contact.remote_jid,
    });

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${DIRECT_VPS_TOKEN}`,
        },
        body: JSON.stringify(payload),
      });
      const txt = await res.text();
      let parsed: any = txt;
      try {
        parsed = JSON.parse(txt);
      } catch {}
      console.log("VPS_RESPONSE", { status: res.status, ok: res.ok, body: parsed });
      await logStep(supabaseAdmin, workspaceId, "VPS_RESPONSE", {
        status: res.status,
        http_ok: res.ok,
        provider_ok: typeof parsed === "object" ? parsed?.ok : undefined,
        body: typeof parsed === "string" ? parsed.slice(0, 800) : parsed,
        to,
        message_id: outboundMsg?.id,
      });

      const providerOk = typeof parsed === "object" ? parsed?.ok === true : false;
      if (res.ok && providerOk) {
        if (outboundMsg?.id) {
          await supabaseAdmin
            .from("messages")
            .update({
              delivery_status: "sent",
              provider_message_id: parsed?.id ?? null,
              delivered_at: new Date().toISOString(),
            })
            .eq("id", outboundMsg.id);
        }
        await logStep(supabaseAdmin, workspaceId, "vps_send_success", {
          to,
          provider_message_id: parsed?.id ?? null,
          message_id: outboundMsg?.id,
        });
      } else {
        const err =
          (typeof parsed === "object" && parsed?.error) ||
          (typeof parsed === "string" ? parsed : `HTTP ${res.status}`);
        await markFailed(`VPS ${res.status}: ${err}`);
        console.log("SEND_FAILED", { status: res.status, error: String(err).slice(0, 400) });
        await logStep(
          supabaseAdmin,
          workspaceId,
          "SEND_FAILED",
          {
            status: res.status,
            http_ok: res.ok,
            provider_ok: providerOk,
            error: String(err).slice(0, 800),
            to,
            message_id: outboundMsg?.id,
          },
          "error",
        );
      }
    } catch (sendErr: any) {
      console.log("SEND_FAILED", sendErr?.message);
      await logStep(
        supabaseAdmin,
        workspaceId,
        "SEND_FAILED",
        { url, error: sendErr?.message, stack: sendErr?.stack?.slice(0, 400), to, message_id: outboundMsg?.id },
        "error",
      );
      await markFailed(`Network: ${sendErr?.message ?? "unknown"}`);
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
