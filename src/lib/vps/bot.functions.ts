import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { sendViaVps, pickRecipient, VPS_SEND_URL } from "./send";

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
      .select("id, workspace_id, contact_id, remote_jid")
      .eq("id", data.conversationId)
      .eq("workspace_id", workspaceId)
      .single();
    if (conversationError) throw conversationError;

    let contact: any = null;
    if (conversation.contact_id) {
      const { data: c } = await context.supabase
        .from("contacts")
        .select("id, phone, remote_jid")
        .eq("id", conversation.contact_id)
        .maybeSingle();
      contact = c;
    }

    const to = pickRecipient(conversation, contact);
    console.log("SEND_BUTTON_CLICKED", { conversation_id: conversation.id });
    console.log("SEND_TO_NUMBER", to);
    await log(context.supabase, workspaceId, "info", "SEND_BUTTON_CLICKED", {
      conversation_id: conversation.id,
      conversation_remote_jid: conversation.remote_jid,
      contact_remote_jid: contact?.remote_jid,
      contact_phone: contact?.phone,
      to,
    });

    if (!to) {
      await log(context.supabase, workspaceId, "error", "VPS_ERROR", {
        error: "no recipient",
        conversation_id: conversation.id,
      });
      throw new Error("No recipient phone available for this conversation");
    }

    const { data: outbound, error: insertError } = await context.supabase
      .from("messages")
      .insert({
        workspace_id: workspaceId,
        conversation_id: conversation.id,
        direction: "outbound",
        sender: "human",
        body: messageText,
        delivery_status: "pending",
        target_jid: to,
      })
      .select()
      .single();
    if (insertError) throw insertError;

    const writeDebug = async (status: "sent" | "failed", debug: string, providerId?: string | null) => {
      const patch: any = {
        delivery_status: status,
        delivery_error: debug.slice(0, 1000),
      };
      if (status === "sent") {
        patch.provider_message_id = providerId ?? null;
        patch.delivered_at = new Date().toISOString();
      }
      await context.supabase.from("messages").update(patch).eq("id", outbound.id);
    };

    console.log("SEND_TO_VPS", { url: VPS_SEND_URL, to, message_id: outbound.id });
    await log(context.supabase, workspaceId, "info", "SEND_TO_VPS", {
      url: VPS_SEND_URL,
      to,
      message: messageText,
      message_id: outbound.id,
    });

    const result = await sendViaVps(to, messageText);
    const debugStr = result.error
      ? `ERROR: ${result.error}`
      : `HTTP ${result.status} ${result.raw}`;

    console.log("VPS_RESPONSE", { status: result.status, ok: result.ok, body: result.body });
    await log(context.supabase, workspaceId, result.ok ? "info" : "error", "VPS_RESPONSE", {
      status: result.status,
      ok: result.ok,
      body: result.body ?? result.raw,
      to,
      message_id: outbound.id,
    });

    if (!result.ok) {
      await log(context.supabase, workspaceId, "error", "VPS_ERROR", {
        status: result.status,
        error: result.error ?? result.body?.error ?? result.raw,
        to,
        message_id: outbound.id,
      });
      await writeDebug("failed", debugStr);
      throw new Error(`VPS send failed: HTTP ${result.status} — ${result.raw || result.error || "no response body"}`);
    }

    await writeDebug("sent", debugStr, result.body?.id ?? null);
    await context.supabase
      .from("conversations")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", conversation.id);

    return { message: { ...outbound, delivery_status: "sent" }, response: result.body };
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
