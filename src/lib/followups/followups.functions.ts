import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { sendViaVps, extractWhatsappSendNumber } from "@/lib/vps/send";
import { tiersFor, followupMessage, type FollowupType } from "@/lib/followups/followups";

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
    const { error, data: rows } = await q.select("id, followup_type, conversation_id");
    if (error) throw error;
    if (rows && rows.length > 0) {
      await context.supabase.from("bot_logs").insert(
        rows.map((r: any) => ({
          workspace_id: wsId,
          bot_name: "lead-followup",
          channel: "whatsapp",
          level: "info",
          message: `FOLLOWUP_CANCELLED ${r.followup_type}`,
          metadata: { followup_id: r.id, conversation_id: r.conversation_id, type: r.followup_type, manual: true },
        })),
      );
    }
    return { cancelled: rows?.length ?? 0 };
  });

export const getFollowupTestMode = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const wsId = await workspaceId(context);
    const { data } = await context.supabase
      .from("ai_settings")
      .select("followup_test_mode")
      .eq("workspace_id", wsId)
      .maybeSingle();
    return { test_mode: !!(data as any)?.followup_test_mode };
  });

export const setFollowupTestMode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ test_mode: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const wsId = await workspaceId(context);
    const { error } = await context.supabase
      .from("ai_settings")
      .update({ followup_test_mode: data.test_mode } as any)
      .eq("workspace_id", wsId);
    if (error) throw error;
    return { test_mode: data.test_mode };
  });

export const runFollowupCheckNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const wsId = await workspaceId(context);

    const log = async (level: "info" | "error", message: string, metadata: any = {}) => {
      await context.supabase.from("bot_logs").insert({
        workspace_id: wsId,
        bot_name: "lead-followup",
        channel: "whatsapp",
        level,
        message,
        metadata: { ...metadata, manual: true },
      } as any);
    };

    const { data: settings } = await context.supabase
      .from("ai_settings")
      .select("followup_test_mode")
      .eq("workspace_id", wsId)
      .maybeSingle();
    const testMode = !!(settings as any)?.followup_test_mode;
    const tiers = tiersFor(testMode);

    await log("info", `FOLLOWUP_CHECK_STARTED test_mode=${testMode}`, { test_mode: testMode });

    const now = new Date();
    const minThresholdMs = tiers[0].thresholdMs;
    const oldestThreshold = new Date(now.getTime() - minThresholdMs);

    const { data: convs, error: convErr } = await context.supabase
      .from("conversations")
      .select("id, workspace_id, contact_id, last_message_at, status, contact:contacts(id, name, phone, whatsapp_number, sender_number, remote_jid, human_takeover, is_blacklisted)")
      .eq("workspace_id", wsId)
      .eq("status", "open")
      .not("last_message_at", "is", null)
      .lte("last_message_at", oldestThreshold.toISOString())
      .limit(500);
    if (convErr) throw convErr;

    const summary = { scanned: 0, created: 0, sent: 0, skipped: 0 };

    for (const c of convs ?? []) {
      summary.scanned++;
      const contact: any = (c as any).contact;
      await log("info", `CONVERSATION_SCANNED ${c.id}`, { conversation_id: c.id, contact_id: contact?.id });

      if (!contact) { summary.skipped++; await log("info", `FOLLOWUP_SKIPPED_REASON no_contact`, { conversation_id: c.id }); continue; }
      if (contact.human_takeover) { summary.skipped++; await log("info", `FOLLOWUP_SKIPPED_REASON human_takeover`, { conversation_id: c.id }); continue; }
      if (contact.is_blacklisted) { summary.skipped++; await log("info", `FOLLOWUP_SKIPPED_REASON blacklisted`, { conversation_id: c.id }); continue; }

      const phone = extractWhatsappSendNumber(
        contact.whatsapp_number, contact.sender_number, contact.phone, contact.remote_jid,
      );
      if (!phone) { summary.skipped++; await log("info", `FOLLOWUP_SKIPPED_REASON invalid_phone`, { conversation_id: c.id }); continue; }

      const { data: lastInbound } = await context.supabase
        .from("messages")
        .select("created_at")
        .eq("conversation_id", c.id)
        .eq("direction", "inbound")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!lastInbound) { summary.skipped++; await log("info", `FOLLOWUP_SKIPPED_REASON no_inbound_message`, { conversation_id: c.id }); continue; }

      const idleMs = now.getTime() - new Date(lastInbound.created_at).getTime();
      await log("info", `LAST_CUSTOMER_MESSAGE_TIME ${lastInbound.created_at} idle_ms=${idleMs}`, {
        conversation_id: c.id, last_customer_message_at: lastInbound.created_at, idle_ms: idleMs,
      });

      const { data: existing } = await context.supabase
        .from("lead_followups")
        .select("followup_type, status")
        .eq("conversation_id", c.id)
        .in("status", ["pending", "sent"]);
      const taken = new Set((existing ?? []).map((r: any) => r.followup_type));

      // Pick highest qualifying tier not already used
      const eligible = [...tiers].reverse().find((t) => idleMs >= t.thresholdMs && !taken.has(t.type));
      if (!eligible) {
        summary.skipped++;
        await log("info", `FOLLOWUP_SKIPPED_REASON no_eligible_tier idle_ms=${idleMs}`, { conversation_id: c.id, taken: Array.from(taken) });
        continue;
      }

      const name = contact.name ?? "there";
      const message = followupMessage(eligible.type as FollowupType, name);

      const { data: inserted, error: insErr } = await context.supabase
        .from("lead_followups")
        .insert({
          workspace_id: wsId,
          contact_id: contact.id,
          conversation_id: c.id,
          phone,
          followup_type: eligible.type,
          message,
          scheduled_at: now.toISOString(),
          status: "pending",
        } as any)
        .select()
        .single();

      if (insErr || !inserted) {
        summary.skipped++;
        await log("error", `FOLLOWUP_SKIPPED_REASON insert_failed ${insErr?.message ?? ""}`, { conversation_id: c.id, code: (insErr as any)?.code });
        continue;
      }
      summary.created++;
      await log("info", `FOLLOWUP_CREATED ${eligible.type} -> ${phone}`, {
        followup_id: inserted.id, conversation_id: c.id, type: eligible.type,
      });

      const result = await sendViaVps(phone, message);
      await log(result.ok ? "info" : "error", `${result.ok ? "FOLLOWUP_SENT" : "FOLLOWUP_FAILED"} ${eligible.type} -> ${phone}`, {
        followup_id: inserted.id, conversation_id: c.id, type: eligible.type,
        vps_status: result.status, vps_body: result.body,
      });

      await context.supabase
        .from("lead_followups")
        .update({
          status: result.ok ? "sent" : "failed",
          sent_at: result.ok ? now.toISOString() : null,
          error: result.ok ? null : (result.error ?? `VPS ${result.status}`),
        } as any)
        .eq("id", inserted.id);

      if (result.ok) summary.sent++;
    }

    return { ok: true, test_mode: testMode, ...summary };
  });
