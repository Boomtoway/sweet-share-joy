import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function getWorkspaceId(supabase: any, userId: string) {
  const { data: profile } = await supabase
    .from("profiles")
    .select("workspace_id")
    .eq("id", userId)
    .single();
  if (!profile?.workspace_id) throw new Error("Workspace not found");
  return profile.workspace_id as string;
}

async function getOrCreateChannel(
  supabase: any,
  workspaceId: string,
  type: "messenger" | "instagram",
) {
  const { data: existing } = await supabase
    .from("channels")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("type", type)
    .maybeSingle();
  if (existing) return existing;
  const { data, error } = await supabase
    .from("channels")
    .insert({
      workspace_id: workspaceId,
      type,
      name: type === "messenger" ? "Facebook Messenger" : "Instagram DM",
      status: "disconnected",
      config: {},
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export const getMetaStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const workspaceId = await getWorkspaceId(context.supabase, context.userId);
    const messenger = await getOrCreateChannel(context.supabase, workspaceId, "messenger");
    const instagram = await getOrCreateChannel(context.supabase, workspaceId, "instagram");
    const { data: pages } = await context.supabase
      .from("meta_pages")
      .select("*")
      .eq("workspace_id", workspaceId);
    const { data: igs } = await context.supabase
      .from("instagram_accounts")
      .select("*")
      .eq("workspace_id", workspaceId);
    return {
      workspaceId,
      messenger,
      instagram,
      pages: pages ?? [],
      instagram_accounts: igs ?? [],
      webhook_url: `/api/public/meta/webhook?workspace_id=${workspaceId}`,
    };
  });

const WebhookCfgSchema = z.object({
  type: z.enum(["messenger", "instagram"]),
  app_id: z.string().optional().default(""),
  app_secret: z.string().optional().default(""),
  verify_token: z.string().optional().default(""),
});

export const saveMetaWebhookConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => WebhookCfgSchema.parse(i))
  .handler(async ({ data, context }) => {
    const workspaceId = await getWorkspaceId(context.supabase, context.userId);
    const channel = await getOrCreateChannel(context.supabase, workspaceId, data.type);
    const { data: updated, error } = await context.supabase
      .from("channels")
      .update({
        config: {
          ...(channel.config ?? {}),
          app_id: data.app_id,
          app_secret: data.app_secret,
          verify_token: data.verify_token,
        },
      })
      .eq("id", channel.id)
      .select()
      .single();
    if (error) throw error;
    return updated;
  });

const PageSchema = z.object({
  page_id: z.string().min(1),
  page_name: z.string().min(1),
  access_token: z.string().min(1),
});

export const connectFacebookPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => PageSchema.parse(i))
  .handler(async ({ data, context }) => {
    const workspaceId = await getWorkspaceId(context.supabase, context.userId);
    const channel = await getOrCreateChannel(context.supabase, workspaceId, "messenger");
    const { data: row, error } = await context.supabase
      .from("meta_pages")
      .insert({
        workspace_id: workspaceId,
        channel_id: channel.id,
        page_id: data.page_id,
        page_name: data.page_name,
        access_token: data.access_token,
        webhook_verified: false,
      })
      .select()
      .single();
    if (error) throw error;
    await context.supabase.from("channels").update({ status: "connected" }).eq("id", channel.id);
    return row;
  });

const IgSchema = z.object({
  ig_user_id: z.string().min(1),
  username: z.string().min(1),
  access_token: z.string().min(1),
});

export const connectInstagramAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => IgSchema.parse(i))
  .handler(async ({ data, context }) => {
    const workspaceId = await getWorkspaceId(context.supabase, context.userId);
    const channel = await getOrCreateChannel(context.supabase, workspaceId, "instagram");
    const { data: row, error } = await context.supabase
      .from("instagram_accounts")
      .insert({
        workspace_id: workspaceId,
        channel_id: channel.id,
        ig_user_id: data.ig_user_id,
        username: data.username,
        access_token: data.access_token,
        webhook_verified: false,
      })
      .select()
      .single();
    if (error) throw error;
    await context.supabase.from("channels").update({ status: "connected" }).eq("id", channel.id);
    return row;
  });

export const disconnectMetaTarget = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ kind: z.enum(["page", "instagram"]), id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const table = data.kind === "page" ? "meta_pages" : "instagram_accounts";
    const { error } = await context.supabase.from(table).delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

const SendSchema = z.object({
  kind: z.enum(["messenger", "instagram"]),
  target_id: z.string().uuid(),
  recipient_id: z.string().min(1),
  message: z.string().min(1),
});

export const sendMetaMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => SendSchema.parse(i))
  .handler(async ({ data, context }) => {
    // Placeholder: real Meta Graph API call will go here once app approval is done.
    // POST https://graph.facebook.com/v19.0/me/messages with page access token.
    await context.supabase.from("bot_logs").insert({
      workspace_id: await getWorkspaceId(context.supabase, context.userId),
      bot_name: "meta-sender",
      channel: data.kind,
      level: "info",
      message: `[placeholder] send to ${data.recipient_id}: ${data.message.slice(0, 80)}`,
    } as any);
    return { ok: true, queued: true };
  });
