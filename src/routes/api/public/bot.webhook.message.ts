import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const WebhookSchema = z.object({
  workspace_id: z.string().uuid(),
  secret: z.string().min(8).optional(),
  from: z.string().min(1),
  remote_jid: z.string().optional(),
  contact_name: z.string().optional(),
  body: z.string().default(""),
  external_id: z.string().optional(),
});

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

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
          workspaceId = body.workspace_id;
          const headerSecret = request.headers.get("x-bot-secret") ?? "";

          queueLog(request, supabaseAdmin, workspaceId, "webhook_received", {
            from: body.from,
            remote_jid: body.remote_jid,
            phone_before_save: body.from,
            preview: body.body.slice(0, 80),
            has_x_bot_secret: Boolean(headerSecret),
          });

          // Sanity check: if a full JID was sent, its user part MUST match `from`.
          if (body.remote_jid) {
            const expected = body.remote_jid.split("@")[0];
            if (expected !== body.from) {
              queueLog(
                request,
                supabaseAdmin,
                workspaceId,
                "phone_saved differs from remoteJid.split('@')[0]",
                { remote_jid: body.remote_jid, from: body.from, expected },
                "error",
              );
            }
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
          const { data: contactByJid } = body.remote_jid
            ? await lookupQuery.eq("remote_jid", body.remote_jid).maybeSingle()
            : { data: null as any };
          let contact = contactByJid as any;
          if (!contact) {
            const { data: contactByPhone } = await supabaseAdmin
              .from("contacts")
              .select("*")
              .eq("workspace_id", workspaceId)
              .eq("phone", body.from)
              .maybeSingle();
            contact = contactByPhone;
          }
          if (!contact) {
            const ins = await supabaseAdmin
              .from("contacts")
              .insert({
                workspace_id: workspaceId,
                phone: body.from,
                remote_jid: body.remote_jid ?? null,
                name: body.contact_name ?? body.from,
                channel: "whatsapp",
                external_id: body.external_id,
              })
              .select()
              .single();
            contact = ins.data;
          } else if (body.remote_jid && contact.remote_jid !== body.remote_jid) {
            // Backfill remote_jid on existing contact
            await supabaseAdmin
              .from("contacts")
              .update({ remote_jid: body.remote_jid })
              .eq("id", contact.id);
            contact.remote_jid = body.remote_jid;
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
            phone_before_save: body.from,
          });


          // Find/create conversation
          let { data: conv } = await supabaseAdmin
            .from("conversations")
            .select("*")
            .eq("workspace_id", workspaceId)
            .eq("contact_id", contact.id)
            .maybeSingle();
          if (!conv) {
            const ins = await supabaseAdmin
              .from("conversations")
              .insert({ workspace_id: workspaceId, contact_id: contact.id })
              .select()
              .single();
            conv = ins.data;
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
            body: body.body,
          });
          await supabaseAdmin
            .from("conversations")
            .update({
              last_message_at: new Date().toISOString(),
              unread_count: (conv.unread_count ?? 0) + 1,
            })
            .eq("id", conv.id);

          queueLog(request, supabaseAdmin, workspaceId, "inbound_saved", { conv_id: conv.id });

          // ---- Everything after inbound persistence runs in the background.
          // The webhook must ACK within 1s and never wait for Gemini/delay/VPS. ----
          const work = generateAndSend({
            supabaseAdmin,
            session,
            conversation: conv,
            contact,
            workspaceId,
            inboundBody: body.body,
            fromPhone: body.from,
            remoteJid: body.remote_jid ?? contact.remote_jid ?? null,
          }).catch((err) =>
            logStep(
              supabaseAdmin,
              workspaceId,
              `generateAndSend crashed: ${err?.message}`,
              { stack: err?.stack?.slice(0, 500) },
              "error",
            ),
          );
          scheduleBackground(request, work);

          queueLog(request, supabaseAdmin, workspaceId, "http_200_returned", {
            queued: true,
            ms: Date.now() - receivedAt,
          });
          return new Response(JSON.stringify({ ok: true, queued: true }), { headers: cors });
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
  fromPhone: string;
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
      await logStep(supabaseAdmin, workspaceId, "Gemini started", {
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
        await logStep(supabaseAdmin, workspaceId, "Gemini completed", {
          ms: Date.now() - t0,
          length: replyText?.length ?? 0,
          model,
          finish_reason: finishReason,
          prompt_feedback: json?.promptFeedback,
          safety_ratings: json?.candidates?.[0]?.safetyRatings,
          usage: json?.usageMetadata,
        });
        await logStep(supabaseAdmin, workspaceId, "gemini_done", {
          ms: Date.now() - t0,
          length: replyText?.length ?? 0,
          finish_reason: finishReason,
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
    await logStep(supabaseAdmin, workspaceId, "Reply saved (pending)", {
      length: replyText.length,
      message_id: outboundMsg?.id,
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

    // Send via VPS /send — use the raw remoteJid if we have one, otherwise the phone digits.
    if (!session.vps_endpoint || !session.vps_api_token) {
      const err = "VPS endpoint/token not configured";
      await logStep(supabaseAdmin, workspaceId, `${err} — cannot send`, {}, "error");
      await markFailed(err);
      return;
    }
    const targetJid = remoteJid && remoteJid.includes("@") ? remoteJid : fromPhone;
    if (outboundMsg?.id) {
      await supabaseAdmin
        .from("messages")
        .update({ target_jid: targetJid })
        .eq("id", outboundMsg.id);
    }
    const url = session.vps_endpoint.replace(/\/$/, "") + "/send";
    const payload = { to: targetJid, message: replyText };
    await logStep(supabaseAdmin, workspaceId, "VPS /send request", {
      url,
      to: targetJid,
      remote_jid: remoteJid,
      phone_before_save: fromPhone,
      message_length: replyText.length,
      message_id: outboundMsg?.id,
    });
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.vps_api_token}`,
        },
        body: JSON.stringify(payload),
      });
      const txt = await res.text();
      let parsed: any = txt;
      try {
        parsed = JSON.parse(txt);
      } catch {}
      await logStep(
        supabaseAdmin,
        workspaceId,
        `VPS /send response ${res.status}`,
        { status: res.status, ok: res.ok, body: txt.slice(0, 800), url, to: targetJid },
        res.ok ? "info" : "error",
      );
      if (!res.ok) {
        const err =
          (typeof parsed === "object" && parsed?.error) ||
          (typeof parsed === "string" ? parsed : `HTTP ${res.status}`);
        await markFailed(`VPS ${res.status}: ${err}`);
        await logStep(supabaseAdmin, workspaceId, "vps_send_done", {
          ok: false,
          status: res.status,
          error: String(err).slice(0, 800),
          to: targetJid,
          message_id: outboundMsg?.id,
        }, "error");
      } else if (outboundMsg?.id) {
        await supabaseAdmin
          .from("messages")
          .update({
            delivery_status: "sent",
            provider_message_id: parsed?.id ?? null,
            delivered_at: new Date().toISOString(),
          })
          .eq("id", outboundMsg.id);
        await logStep(supabaseAdmin, workspaceId, "Reply sent", {
          to: targetJid,
          provider_message_id: parsed?.id ?? null,
          message_id: outboundMsg.id,
        });
        await logStep(supabaseAdmin, workspaceId, "vps_send_done", {
          ok: true,
          status: res.status,
          to: targetJid,
          provider_message_id: parsed?.id ?? null,
          message_id: outboundMsg.id,
        });
      }
    } catch (sendErr: any) {
      await logStep(
        supabaseAdmin,
        workspaceId,
        `VPS /send fetch failed: ${sendErr?.message}`,
        { url, stack: sendErr?.stack?.slice(0, 400) },
        "error",
      );
      await markFailed(`Network: ${sendErr?.message ?? "unknown"}`);
      await logStep(supabaseAdmin, workspaceId, "vps_send_done", {
        ok: false,
        error: sendErr?.message ?? "unknown",
        to: targetJid,
        message_id: outboundMsg?.id,
      }, "error");
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
