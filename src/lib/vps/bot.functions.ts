import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

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
