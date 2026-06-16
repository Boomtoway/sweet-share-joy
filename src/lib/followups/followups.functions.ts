import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { sendViaVps, extractWhatsappSendNumber } from "@/lib/vps/send";
import { tiersFor, followupMessage, TEST_FOLLOWUP_TIERS, type FollowupType } from "@/lib/followups/followups";

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

type DebugRow = {
  conversation_id: string;
  contact_id: string | null;
  name: string | null;
  phone: string | null;
  last_customer_message_at: string | null;
  minutes_since_last_customer_message: number | null;
  reason: string;
  action: "CREATED" | "SENT" | "SKIPPED";
  followup_type?: string | null;
  detail?: string | null;
};

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
    const minTestThreshold = TEST_FOLLOWUP_TIERS[0].thresholdMs;

    await log("info", `FOLLOWUP_CHECK_STARTED test_mode=${testMode}`, { test_mode: testMode });

    const now = new Date();

    // Scan ALL open conversations (no threshold pre-filter) so we can report every skip reason
    const { data: convs, error: convErr } = await context.supabase
      .from("conversations")
      .select("id, workspace_id, contact_id, last_message_at, status, whatsapp_number, sender_number, remote_jid, contact:contacts(id, name, phone, whatsapp_number, sender_number, remote_jid, human_takeover, is_blacklisted)")
      .eq("workspace_id", wsId)
      .eq("status", "open")
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(500);
    if (convErr) throw convErr;

    const debug: DebugRow[] = [];
    const summary = { scanned: 0, created: 0, sent: 0, skipped: 0 };

    for (const c of convs ?? []) {
      summary.scanned++;
      const contact: any = (c as any).contact;
      const name = contact?.name ?? null;
      const phone = extractWhatsappSendNumber(
        (c as any).whatsapp_number, (c as any).sender_number,
        contact?.whatsapp_number, contact?.sender_number, contact?.phone, contact?.remote_jid, (c as any).remote_jid,
      ) || null;

      const push = (reason: string, extra: Partial<DebugRow> = {}) => {
        const row: DebugRow = {
          conversation_id: c.id,
          contact_id: contact?.id ?? null,
          name,
          phone,
          last_customer_message_at: null,
          minutes_since_last_customer_message: null,
          reason,
          action: "SKIPPED",
          ...extra,
        };
        debug.push(row);
      };

      await log("info", `CONVERSATION_SCANNED ${c.id}`, { conversation_id: c.id, contact_id: contact?.id });

      if (!contact) { summary.skipped++; push("NO_CONTACT"); await log("info", `FOLLOWUP_SKIPPED_REASON NO_CONTACT`, { conversation_id: c.id }); continue; }
      if (contact.human_takeover) { summary.skipped++; push("HUMAN_TAKEOVER"); await log("info", `FOLLOWUP_SKIPPED_REASON HUMAN_TAKEOVER`, { conversation_id: c.id }); continue; }
      if (contact.is_blacklisted) { summary.skipped++; push("BLACKLISTED"); await log("info", `FOLLOWUP_SKIPPED_REASON BLACKLISTED`, { conversation_id: c.id }); continue; }
      if (!phone) { summary.skipped++; push("INVALID_PHONE"); await log("info", `FOLLOWUP_SKIPPED_REASON INVALID_PHONE`, { conversation_id: c.id }); continue; }

      if (!c.last_message_at) {
        summary.skipped++; push("MISSING_TIMESTAMP");
        await log("info", `FOLLOWUP_SKIPPED_REASON MISSING_TIMESTAMP`, { conversation_id: c.id });
        continue;
      }

      const { data: lastInbound } = await context.supabase
        .from("messages")
        .select("created_at")
        .eq("conversation_id", c.id)
        .eq("direction", "inbound")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!lastInbound) {
        summary.skipped++; push("NO_CUSTOMER_MESSAGE");
        await log("info", `FOLLOWUP_SKIPPED_REASON NO_CUSTOMER_MESSAGE`, { conversation_id: c.id });
        continue;
      }

      const lastAt = lastInbound.created_at as string;
      const idleMs = now.getTime() - new Date(lastAt).getTime();
      const minutes = Math.round(idleMs / 60000);
      await log("info", `LAST_CUSTOMER_MESSAGE_TIME ${lastAt} idle_ms=${idleMs}`, {
        conversation_id: c.id, last_customer_message_at: lastAt, idle_ms: idleMs,
      });

      const { data: existing } = await context.supabase
        .from("lead_followups")
        .select("followup_type, status")
        .eq("conversation_id", c.id)
        .in("status", ["pending", "sent"]);
      const pendingTypes = new Set((existing ?? []).filter((r: any) => r.status === "pending").map((r: any) => r.followup_type));
      const sentTypes = new Set((existing ?? []).filter((r: any) => r.status === "sent").map((r: any) => r.followup_type));
      const taken = new Set([...pendingTypes, ...sentTypes]);

      const eligible = [...tiers].reverse().find((t) => idleMs >= t.thresholdMs && !taken.has(t.type));

      if (!eligible) {
        // Determine fine-grained reason
        const anyEligibleIgnoringTaken = [...tiers].reverse().find((t) => idleMs >= t.thresholdMs);
        let reason: string;
        let detail: string | null = null;
        if (!anyEligibleIgnoringTaken) {
          if (!testMode && idleMs >= minTestThreshold) {
            reason = "TEST_MODE_DISABLED";
            detail = `Idle ${minutes}m — would qualify in TEST MODE (≥${Math.round(minTestThreshold/60000)}m).`;
          } else {
            reason = "RECENT_ACTIVITY";
            detail = `Idle ${minutes}m < threshold ${Math.round(tiers[0].thresholdMs/60000)}m`;
          }
        } else if (pendingTypes.has(anyEligibleIgnoringTaken.type)) {
          reason = "FOLLOWUP_ALREADY_EXISTS";
          detail = `Pending ${anyEligibleIgnoringTaken.type}`;
        } else {
          reason = "FOLLOWUP_ALREADY_SENT";
          detail = `Sent: ${Array.from(sentTypes).join(", ")}`;
        }
        summary.skipped++;
        push(reason, { last_customer_message_at: lastAt, minutes_since_last_customer_message: minutes, detail });
        await log("info", `FOLLOWUP_SKIPPED_REASON ${reason}`, { conversation_id: c.id, idle_ms: idleMs, taken: Array.from(taken), detail });
        continue;
      }

      const message = followupMessage(eligible.type as FollowupType, name ?? "there");
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
        push("INSERT_FAILED", { last_customer_message_at: lastAt, minutes_since_last_customer_message: minutes, detail: insErr?.message ?? null });
        await log("error", `FOLLOWUP_SKIPPED_REASON INSERT_FAILED ${insErr?.message ?? ""}`, { conversation_id: c.id });
        continue;
      }
      summary.created++;
      debug.push({
        conversation_id: c.id, contact_id: contact.id, name, phone,
        last_customer_message_at: lastAt, minutes_since_last_customer_message: minutes,
        reason: "CREATED", action: "CREATED", followup_type: eligible.type,
      });
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

      if (result.ok) {
        summary.sent++;
        debug.push({
          conversation_id: c.id, contact_id: contact.id, name, phone,
          last_customer_message_at: lastAt, minutes_since_last_customer_message: minutes,
          reason: "SENT", action: "SENT", followup_type: eligible.type,
        });
      }
    }

    return { ok: true, test_mode: testMode, ...summary, debug };
  });

export const listConversationsForFollowup = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const wsId = await workspaceId(context);
    const { data, error } = await context.supabase
      .from("conversations")
      .select("id, last_message_at, whatsapp_number, sender_number, remote_jid, contact:contacts(id, name, phone, whatsapp_number, sender_number, remote_jid)")
      .eq("workspace_id", wsId)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(200);
    if (error) throw error;
    return (data ?? []).map((c: any) => ({
      id: c.id,
      name: c.contact?.name ?? null,
      phone: extractWhatsappSendNumber(
        c.whatsapp_number, c.sender_number, c.contact?.whatsapp_number, c.contact?.sender_number, c.contact?.phone, c.contact?.remote_jid, c.remote_jid,
      ) || null,
      last_message_at: c.last_message_at,
      contact_id: c.contact?.id ?? null,
    }));
  });

export const forceCreateTestFollowup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ conversation_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const wsId = await workspaceId(context);

    const log = async (level: "info" | "error", message: string, metadata: any = {}) => {
      await context.supabase.from("bot_logs").insert({
        workspace_id: wsId, bot_name: "lead-followup", channel: "whatsapp",
        level, message, metadata: { ...metadata, manual: true, force: true },
      } as any);
    };

    const { data: c, error } = await context.supabase
      .from("conversations")
      .select("id, workspace_id, contact_id, whatsapp_number, sender_number, remote_jid, contact:contacts(id, name, phone, whatsapp_number, sender_number, remote_jid)")
      .eq("id", data.conversation_id)
      .eq("workspace_id", wsId)
      .single();
    if (error || !c) throw new Error("Conversation not found");

    const contact: any = (c as any).contact;
    const phone = extractWhatsappSendNumber(
      (c as any).whatsapp_number, (c as any).sender_number,
      contact?.whatsapp_number, contact?.sender_number, contact?.phone, contact?.remote_jid, (c as any).remote_jid,
    );
    if (!phone) throw new Error("Invalid WhatsApp number on conversation");

    const name = contact?.name ?? "there";
    const message = followupMessage("day_1", name);
    const now = new Date();

    const { data: inserted, error: insErr } = await context.supabase
      .from("lead_followups")
      .insert({
        workspace_id: wsId,
        contact_id: contact?.id ?? null,
        conversation_id: c.id,
        phone,
        followup_type: "day_1",
        message,
        scheduled_at: now.toISOString(),
        status: "pending",
      } as any)
      .select()
      .single();
    if (insErr || !inserted) throw new Error(`Insert failed: ${insErr?.message ?? "unknown"}`);

    await log("info", `FOLLOWUP_CREATED day_1 (FORCED) -> ${phone}`, { followup_id: inserted.id, conversation_id: c.id });

    const result = await sendViaVps(phone, message);
    await log(result.ok ? "info" : "error", `${result.ok ? "FOLLOWUP_SENT" : "FOLLOWUP_FAILED"} day_1 (FORCED) -> ${phone}`, {
      followup_id: inserted.id, conversation_id: c.id, vps_status: result.status, vps_body: result.body,
    });

    await context.supabase
      .from("lead_followups")
      .update({
        status: result.ok ? "sent" : "failed",
        sent_at: result.ok ? now.toISOString() : null,
        error: result.ok ? null : (result.error ?? `VPS ${result.status}`),
      } as any)
      .eq("id", inserted.id);

    if (!result.ok) throw new Error(result.error ?? `VPS send failed (${result.status})`);
    return { ok: true, followup_id: inserted.id, phone };
  });

export const repairContacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const wsId = await workspaceId(context);

    const { data: convs, error } = await context.supabase
      .from("conversations")
      .select("id, contact_id, remote_jid, whatsapp_number, sender_number, contact:contacts(id, phone, whatsapp_number, sender_number, remote_jid)")
      .eq("workspace_id", wsId)
      .limit(5000);
    if (error) throw error;

    let scanned = 0;
    let repaired = 0;
    let convsUpdated = 0;
    const issues: Array<{ conversation_id: string; reason: string }> = [];

    for (const c of convs ?? []) {
      scanned++;
      const contact: any = (c as any).contact;
      const phone = extractWhatsappSendNumber(
        (c as any).whatsapp_number, (c as any).sender_number, (c as any).remote_jid,
        contact?.whatsapp_number, contact?.sender_number, contact?.phone, contact?.remote_jid,
      );
      if (!phone) { issues.push({ conversation_id: c.id, reason: "NO_EXTRACTABLE_PHONE" }); continue; }

      if (contact) {
        const updates: any = {};
        if (!contact.whatsapp_number) updates.whatsapp_number = phone;
        if (!contact.phone) updates.phone = phone;
        if (!contact.sender_number && (c as any).sender_number) updates.sender_number = (c as any).sender_number;
        if (!contact.remote_jid && (c as any).remote_jid) updates.remote_jid = (c as any).remote_jid;
        if (Object.keys(updates).length > 0) {
          const { error: uErr } = await context.supabase.from("contacts").update(updates).eq("id", contact.id).eq("workspace_id", wsId);
          if (!uErr) repaired++;
        }
      }

      const convUpdates: any = {};
      if (!(c as any).whatsapp_number) convUpdates.whatsapp_number = phone;
      if (Object.keys(convUpdates).length > 0) {
        const { error: cErr } = await context.supabase.from("conversations").update(convUpdates).eq("id", c.id).eq("workspace_id", wsId);
        if (!cErr) convsUpdated++;
      }
    }

    await context.supabase.from("bot_logs").insert({
      workspace_id: wsId, bot_name: "lead-followup", channel: "whatsapp",
      level: "info", message: `REPAIR_CONTACTS scanned=${scanned} repaired=${repaired} convs_updated=${convsUpdated}`,
      metadata: { manual: true, scanned, repaired, convs_updated: convsUpdated, issues: issues.slice(0, 50) },
    } as any);

    return { ok: true, scanned, repaired, convs_updated: convsUpdated, issues };
  });

export const cleanupDuplicateContactsWithoutPhone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const wsId = await workspaceId(context);

    // Find contacts without any phone information.
    const { data: empties, error } = await context.supabase
      .from("contacts")
      .select("id, name, created_at")
      .eq("workspace_id", wsId)
      .is("phone", null)
      .is("whatsapp_number", null)
      .is("sender_number", null)
      .is("remote_jid", null);
    if (error) throw error;

    let deleted = 0;
    const skipped: Array<{ id: string; reason: string }> = [];

    for (const c of empties ?? []) {
      // Skip if referenced by a conversation that has a phone (data may still be useful)
      const { data: convs } = await context.supabase
        .from("conversations")
        .select("id, remote_jid, whatsapp_number, sender_number")
        .eq("contact_id", c.id)
        .limit(5);
      const hasUsefulConv = (convs ?? []).some((cv: any) =>
        extractWhatsappSendNumber(cv.whatsapp_number, cv.sender_number, cv.remote_jid),
      );
      if (hasUsefulConv) { skipped.push({ id: c.id, reason: "CONV_HAS_PHONE" }); continue; }

      const { error: dErr } = await context.supabase
        .from("contacts").delete().eq("id", c.id).eq("workspace_id", wsId);
      if (dErr) skipped.push({ id: c.id, reason: dErr.message });
      else deleted++;
    }

    await context.supabase.from("bot_logs").insert({
      workspace_id: wsId, bot_name: "lead-followup", channel: "whatsapp",
      level: "info", message: `CLEANUP_CONTACTS deleted=${deleted} skipped=${skipped.length}`,
      metadata: { manual: true, deleted, skipped: skipped.slice(0, 50) },
    } as any);

    return { ok: true, deleted, skipped };
  });
