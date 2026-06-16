import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { sendViaVps, extractWhatsappSendNumber } from "@/lib/vps/send";
import { REMINDER_TIERS, reminderMessage, type ReminderTier } from "./reminders";

const SendNowSchema = z.object({
  id: z.string().uuid(),
  tier: z.enum(["24h", "1h", "15m", "manual"]).optional(),
});

async function workspaceId(context: any) {
  const { data: profile } = await context.supabase
    .from("profiles")
    .select("workspace_id")
    .eq("id", context.userId)
    .single();
  if (!profile?.workspace_id) throw new Error("Workspace not found");
  return profile.workspace_id as string;
}

export const sendReminderNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SendNowSchema.parse(d))
  .handler(async ({ data, context }) => {
    const wsId = await workspaceId(context);
    const { data: appt, error } = await context.supabase
      .from("appointments")
      .select("*")
      .eq("id", data.id)
      .eq("workspace_id", wsId)
      .single();
    if (error || !appt) throw new Error("Appointment not found");

    const phone = extractWhatsappSendNumber(appt.phone);
    if (!phone) throw new Error("Appointment phone is not a valid WhatsApp number");

    const dt = appt.appointment_datetime ? new Date(appt.appointment_datetime) : new Date();
    const tier = (data.tier ?? "manual") as ReminderTier | "manual";
    const name = appt.name ?? "there";
    const message = tier === "manual"
      ? `Hi ${name}, this is a reminder about your appointment on ${dt.toLocaleString()}.`
      : reminderMessage(tier as ReminderTier, name, dt);

    const result = await sendViaVps(phone, message);

    const logCode = tier === "manual" ? "REMINDER_MANUAL_SENT" : REMINDER_TIERS.find((t) => t.tier === tier)!.logCode;
    await context.supabase.from("bot_logs").insert({
      workspace_id: wsId,
      bot_name: "appointment-reminder",
      channel: "whatsapp",
      level: result.ok ? "info" : "error",
      message: `${logCode} ${result.ok ? "ok" : "failed"} -> ${phone}`,
      metadata: {
        appointment_id: appt.id,
        tier,
        phone,
        message,
        vps_status: result.status,
        vps_body: result.body,
        manual: tier === "manual",
      },
    } as any);

    if (result.ok && tier !== "manual") {
      const tierDef = REMINDER_TIERS.find((t) => t.tier === tier)!;
      await context.supabase
        .from("appointments")
        .update({ [tierDef.flag]: true } as any)
        .eq("id", appt.id)
        .eq("workspace_id", wsId);
    }

    if (!result.ok) throw new Error(result.error ?? `VPS send failed (${result.status})`);
    return { ok: true, tier, phone };
  });

export const listReminderLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ appointment_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const wsId = await workspaceId(context);
    const { data: rows, error } = await context.supabase
      .from("bot_logs")
      .select("*")
      .eq("workspace_id", wsId)
      .eq("bot_name", "appointment-reminder")
      .contains("metadata", { appointment_id: data.appointment_id })
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return rows ?? [];
  });
