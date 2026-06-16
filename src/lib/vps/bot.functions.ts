import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  sendViaVps,
  extractWhatsappSendNumber,
  pickRecipient,
  VPS_SEND_URL,
  VPS_TOKEN,
  getVpsResponseText,
} from "./send";

async function getSession(supabase: any, userId: string) {
  const { data: profile } = await supabase
    .from("profiles")
    .select("workspace_id")
    .eq("id", userId)
    .single();
  if (!profile?.workspace_id) throw new Error("Workspace not found");
  const { data: session } = await supabase
    .from("whatsapp_sessions")
    .select("*")
    .eq("workspace_id", profile.workspace_id)
    .maybeSingle();
  return { workspaceId: profile.workspace_id as string, session };
}

async function callVps(
  session: { vps_endpoint: string | null; vps_api_token: string | null },
  path: string,
  init: RequestInit = {},
) {
  if (!session.vps_endpoint) throw new Error("VPS endpoint not configured");
  const url = session.vps_endpoint.replace(/\/$/, "") + path;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.vps_api_token ?? ""}`,
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {}
  if (!res.ok) throw new Error(typeof body === "string" ? body : body.error || `VPS error ${res.status}`);
  return body;
}

export const getVpsConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId, session } = await getSession(context.supabase, context.userId);
    if (session) return session;
    const { data, error } = await context.supabase
      .from("whatsapp_sessions")
      .insert({ workspace_id: workspaceId })
      .select()
      .single();
    if (error) throw error;
    return data;
  });

const ConfigSchema = z.object({
  vps_endpoint: z.string().url().or(z.literal("")),
  vps_api_token: z.string().optional(),
  daily_limit: z.number().int().min(0).max(10000),
  min_delay_seconds: z.number().int().min(0).max(600),
  max_delay_seconds: z.number().int().min(0).max(600),
  ai_enabled: z.boolean(),
  list_mode: z.enum(["off", "whitelist", "blacklist"]),
  facebook_lead_only: z.boolean(),
});

const ManualSendSchema = z.object({
  conversationId: z.string().uuid(),
  message: z.string().trim().min(1).max(4000),
  to: z.string().trim().min(1).optional(),
});

const TestSendSchema = z.object({
  to: z.string().trim().min(1).default("94740123466"),
  message: z.string().trim().min(1).max(4000).default("Test from Lovable"),
});

export const saveVpsConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ConfigSchema.parse(i))
  .handler(async ({ context, data }) => {
    const { workspaceId } = await getSession(context.supabase, context.userId);
    const { data: updated, error } = await context.supabase
      .from("whatsapp_sessions")
      .update(data)
      .eq("workspace_id", workspaceId)
      .select()
      .single();
    if (error) throw error;
    return updated;
  });

export const sendManualWhatsAppMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ManualSendSchema.parse(i))
  .handler(async ({ context, data }) => {
    const { workspaceId } = await getSession(context.supabase, context.userId);
    const messageText = data.message.trim();

    const { data: conversation, error: conversationError } = await context.supabase
      .from("conversations")
      .select("*")
      .eq("id", data.conversationId)
      .eq("workspace_id", workspaceId)
      .single();
    if (conversationError) throw conversationError;

    let contact: any = null;
    if (conversation.contact_id) {
      const { data: c } = await context.supabase
        .from("contacts")
        .select("*")
        .eq("id", conversation.contact_id)
        .maybeSingle();
      contact = c;
    }

    // Exact manual send target assignment:
    // DB sender fields from the currently selected conversation/contact only.
    // The client-provided `to` is logged for traceability but is never trusted
    // as the send target, so stale UI state/history recipients/internal IDs
    // cannot become WhatsApp numbers.
    const phone = contact?.phone ?? contact?.whatsapp_number ?? contact?.sender_number ?? "";
    const remoteJid = conversation.remote_jid || contact?.remote_jid || "";
    const extractedWhatsappNumber = extractWhatsappSendNumber(
      (conversation as any).whatsapp_number,
      (conversation as any).sender_number,
      contact?.whatsapp_number,
      contact?.sender_number,
      conversation.remote_jid,
      contact?.remote_jid,
      contact?.phone,
    );
    const to = extractedWhatsappNumber;

    console.log("MANUAL_SEND_START", {
      conversation_id: conversation.id,
      contact_id: conversation.contact_id,
      client_to: data.to ?? null,
      phone,
      remote_jid: remoteJid,
      extracted_whatsapp_number: extractedWhatsappNumber,
      final_send_number: to,
    });
    await log(context.supabase, workspaceId, "info", "MANUAL_SEND_START", {
      conversation_id: conversation.id,
      contact_id: conversation.contact_id,
      client_to: data.to ?? null,
      phone,
      remote_jid: remoteJid,
      extracted_whatsapp_number: extractedWhatsappNumber,
      final_send_number: to,
    });
    await log(context.supabase, workspaceId, "info", "MANUAL_SEND_NUMBER", {
      contact_id: conversation.contact_id,
      phone,
      remote_jid: remoteJid,
      final_send_number: to,
    });

    if (!to) {
      await log(context.supabase, workspaceId, "error", "VPS_ERROR", {
        error: "Invalid WhatsApp number",
        conversation_id: conversation.id,
        contact_id: conversation.contact_id,
        phone,
        remote_jid: remoteJid,
        extracted_whatsapp_number: extractedWhatsappNumber,
        final_send_number: to,
      });
      throw new Error("Invalid WhatsApp number");
    }

    // Call the EXACT SAME sender used by Test VPS Send.
    const result = await sendViaVps(to, messageText);
    const responseText = getVpsResponseText(result);
    const debugStr = `FINAL_SEND_NUMBER: ${to} | VPS_RESPONSE: ok ${result.ok} | HTTP ${result.status} ${responseText}`;

    await log(context.supabase, workspaceId, "info", "FINAL_SEND_NUMBER", {
      contact_id: conversation.contact_id,
      phone,
      remote_jid: remoteJid,
      final_send_number: to,
      ok: result.ok,
    });

    console.log("MANUAL_SEND_RESPONSE", { status: result.status, ok: result.ok, body: responseText });
    await log(context.supabase, workspaceId, result.ok ? "info" : "error", "MANUAL_SEND_RESPONSE", {
      status: result.status,
      ok: result.ok,
      body: responseText,
      parsed_body: result.body,
      contact_id: conversation.contact_id,
      phone,
      remote_jid: remoteJid,
      extracted_whatsapp_number: extractedWhatsappNumber,
      final_send_number: to,
    });

    // Persist message AFTER send so VPS response is visible under the bubble.
    const { data: outbound, error: insertError } = await context.supabase
      .from("messages")
      .insert({
        workspace_id: workspaceId,
        conversation_id: conversation.id,
        direction: "outbound",
        sender: "human",
        body: messageText,
        delivery_status: result.ok ? "sent" : "failed",
        delivery_error: debugStr,
        target_jid: to,
        provider_message_id: result.ok ? result.body?.id ?? null : null,
        delivered_at: result.ok ? new Date().toISOString() : null,
      })
      .select()
      .single();
    if (insertError) {
      await log(context.supabase, workspaceId, "error", "MANUAL_SEND_PERSIST_FAILED", {
        error: insertError.message,
      });
    }

    if (!result.ok) {
      throw new Error(`VPS send failed: HTTP ${result.status} — ${responseText || "no response body"}`);
    }

    await context.supabase
      .from("conversations")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", conversation.id);

    return { message: outbound, response: result.body, raw: result.raw, finalSendNumber: to };
  });

export const testVpsSend = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => TestSendSchema.parse(i ?? {}))
  .handler(async ({ context, data }) => {
    const { workspaceId } = await getSession(context.supabase, context.userId);
    const to = pickRecipient({ remote_jid: data.to }, null);
    const requestHeaders = { Authorization: `Bearer ${VPS_TOKEN}`, "Content-Type": "application/json" };
    const requestBody = JSON.stringify({ to, message: data.message });

    await log(context.supabase, workspaceId, "info", "SEND_TO_VPS", { url: VPS_SEND_URL, to, message: data.message, source: "TestVpsSendButton" });
    await log(context.supabase, workspaceId, "info", "VPS_URL", { url: VPS_SEND_URL, source: "TestVpsSendButton" });
    await log(context.supabase, workspaceId, "info", "REQUEST_HEADERS", { headers: requestHeaders, source: "TestVpsSendButton" });
    await log(context.supabase, workspaceId, "info", "REQUEST_BODY", { body: requestBody, source: "TestVpsSendButton" });

    const result = await sendViaVps(to, data.message);
    const responseText = getVpsResponseText(result);
    await log(context.supabase, workspaceId, result.ok ? "info" : "error", "RESPONSE_STATUS", { status: result.status, ok: result.ok, source: "TestVpsSendButton" });
    await log(context.supabase, workspaceId, result.ok ? "info" : "error", "RESPONSE_BODY", { body: responseText, parsed_body: result.body, source: "TestVpsSendButton" });
    await log(context.supabase, workspaceId, result.ok ? "info" : "error", "VPS_RESPONSE", { status: result.status, ok: result.ok, body: responseText, parsed_body: result.body, to, source: "TestVpsSendButton" });

    if (!result.ok) {
      await log(context.supabase, workspaceId, "error", "VPS_ERROR", { status: result.status, error: responseText, to, source: "TestVpsSendButton" });
      throw new Error(`VPS send failed: HTTP ${result.status} — ${responseText || "no response body"}`);
    }
    return { ok: true, status: result.status, body: result.body, raw: result.raw };
  });

async function log(
  supabase: any,
  workspaceId: string,
  level: "info" | "warn" | "error",
  message: string,
  metadata: Record<string, unknown> = {},
) {
  await supabase.from("bot_logs").insert({
    workspace_id: workspaceId,
    bot_name: "whatsapp-vps",
    channel: "whatsapp",
    level,
    message,
    metadata,
  });
}

async function action(context: any, path: string, method = "POST") {
  const { workspaceId, session } = await getSession(context.supabase, context.userId);
  if (!session) throw new Error("Configure VPS first");
  try {
    const result = await callVps(session, path, { method });
    await log(context.supabase, workspaceId, "info", `VPS ${method} ${path} ok`, { result });
    return result;
  } catch (e: any) {
    await log(context.supabase, workspaceId, "error", `VPS ${method} ${path} failed: ${e.message}`);
    throw e;
  }
}

export const testVpsConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => action(context, "/api/bot/session-status"));

export const getVpsStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => action(context, "/api/bot/session-status"));

export const getVpsQr = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => action(context, "/api/bot/qr", "GET"));

export const restartVpsSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => action(context, "/api/bot/restart"));

export const disconnectVpsSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => action(context, "/api/bot/disconnect"));

export const getBotLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId } = await getSession(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("bot_logs")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return data;
  });

export const rotateWebhookSecret = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId } = await getSession(context.supabase, context.userId);
    const secret = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    const { data, error } = await context.supabase
      .from("whatsapp_sessions")
      .update({ webhook_secret: secret })
      .eq("workspace_id", workspaceId)
      .select()
      .single();
    if (error) throw error;
    return data;
  });
