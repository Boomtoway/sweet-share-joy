import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { sendViaVps, extractWhatsappSendNumber } from "@/lib/vps/send";

async function workspaceId(context: any) {
  const { data: profile } = await context.supabase
    .from("profiles")
    .select("workspace_id")
    .eq("id", context.userId)
    .single();
  if (!profile?.workspace_id) throw new Error("Workspace not found");
  return profile.workspace_id as string;
}

export const listFollowups = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const wsId = await workspaceId(context);
    const { data, error } = await context.supabase
      .from("lead_followups")
      .select("*, contact:contacts(id, name, phone)")
      .eq("workspace_id", wsId)
      .order("scheduled_at", { ascending: false })
      .limit(500);
    if (error) throw error;
    return data ?? [];
  });

export const sendFollowupNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const wsId = await workspaceId(context);
    const { data: row, error } = await context.supabase
      .from("lead_followups")
      .select("*")
      .eq("id", data.id)
      .eq("workspace_id", wsId)
      .single();
    if (error || !row) throw new Error("Follow-up not found");

    const phone = extractWhatsappSendNumber(row.phone);
    if (!phone) throw new Error("Invalid WhatsApp number on follow-up");

    const result = await sendViaVps(phone, row.message);

    await context.supabase.from("bot_logs").insert({
      workspace_id: wsId,
      bot_name: "lead-followup",
      channel: "whatsapp",
      level: result.ok ? "info" : "error",
      message: `${result.ok ? "FOLLOWUP_SENT" : "FOLLOWUP_FAILED"} ${row.followup_type} -> ${phone}`,
      metadata: { followup_id: row.id, conversation_id: row.conversation_id, type: row.followup_type, manual: true, vps_status: result.status, vps_body: result.body },
    } as any);

    await context.supabase
      .from("lead_followups")
      .update({
        status: result.ok ? "sent" : "failed",
        sent_at: result.ok ? new Date().toISOString() : null,
        error: result.ok ? null : (result.error ?? `VPS ${result.status}`),
      } as any)
      .eq("id", row.id)
      .eq("workspace_id", wsId);

    if (!result.ok) throw new Error(result.error ?? `VPS send failed (${result.status})`);
    return { ok: true };
  });

export const stopFollowups = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid().optional(), conversation_id: z.string().uuid().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const wsId = await workspaceId(context);
    let q = context.supabase
      .from("lead_followups")
      .update({ status: "cancelled" } as any)
      .eq("workspace_id", wsId)
      .eq("status", "pending");
    if (data.id) q = q.eq("id", data.id);
    if (data.conversation_id) q = q.eq("conversation_id", data.conversation_id);
    const { error, data: rows } = await q.select("id");
    if (error) throw error;
    return { cancelled: rows?.length ?? 0 };
  });
