import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const DIRECT_VPS_SEND_URL = "https://bot.statapplkmarketing.shop/send";
const DIRECT_VPS_TOKEN = "startapplk-bot-12345";
const TEST_VPS_RECIPIENT = "94740123466";

const BLOCKED_RECIPIENTS = new Set(["27771812204615"]);

function pickVpsRecipient(conversation: any, contact: any): string {
  const raw =
    (conversation && typeof conversation.remote_jid === "string" && conversation.remote_jid) ||
    (contact && typeof contact.phone === "string" && contact.phone) ||
    TEST_VPS_RECIPIENT;
  let digits = String(raw).split("@")[0].replace(/\D/g, "");
  if (digits.startsWith("0")) digits = "94" + digits.slice(1);
  if (!digits || BLOCKED_RECIPIENTS.has(digits)) return TEST_VPS_RECIPIENT;
  return digits;
}

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

    const to = pickVpsRecipient(conversation, contact);

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

    const markFailed = async (err: string) => {
      await context.supabase
        .from("messages")
        .update({ delivery_status: "failed", delivery_error: err.slice(0, 1000) })
        .eq("id", outbound.id);
    };

    const sendBody = { to, message: messageText };
    console.log("SENDING_TO_VPS_URL", DIRECT_VPS_SEND_URL);
    console.log("SEND_BODY", sendBody);

    let vpsSucceeded = false;
    try {
      const res = await fetch(DIRECT_VPS_SEND_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${DIRECT_VPS_TOKEN}`,
        },
        body: JSON.stringify(sendBody),
      });
      const responseText = await res.text();
      let responseBody: any = responseText;
      try {
        responseBody = JSON.parse(responseText);
      } catch {}
      console.log("VPS_RESPONSE", { status: res.status, ok: res.ok, body: responseBody });

      if (!res.ok || responseBody?.ok !== true) {
        const err = responseBody?.error || responseText || `HTTP ${res.status}`;
        await markFailed(`VPS ${res.status}: ${err}`);
        throw new Error(`VPS ${res.status}: ${err}`);
      }
      vpsSucceeded = true;

      const { data: sent, error: updateError } = await context.supabase
        .from("messages")
        .update({
          delivery_status: "sent",
          provider_message_id: responseBody?.id ?? null,
          delivered_at: new Date().toISOString(),
        })
        .eq("id", outbound.id)
        .select()
        .single();
      if (updateError) throw updateError;

      await context.supabase
        .from("conversations")
        .update({ last_message_at: new Date().toISOString() })
        .eq("id", conversation.id);

      return { message: sent, response: responseBody };
    } catch (e: any) {
      if (!vpsSucceeded) await markFailed(e?.message ?? "VPS send failed");
      throw e;
    }
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
