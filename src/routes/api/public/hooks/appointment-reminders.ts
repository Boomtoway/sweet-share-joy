import { createFileRoute } from "@tanstack/react-router";
import { sendViaVps, extractWhatsappSendNumber } from "@/lib/vps/send";
import { REMINDER_TIERS, reminderMessage } from "@/lib/appointments/reminders";

// Cron-invoked endpoint. Scans appointments and dispatches reminders.
// Tier policy: send a tier if its flag is false, now >= appointment - tier offset,
// and now <= appointment + 5min grace (avoid spamming after the appointment).
export const Route = createFileRoute("/api/public/hooks/appointment-reminders")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const now = new Date();
        const horizon = new Date(now.getTime() + 25 * 60 * 60 * 1000); // upcoming within 25h
        const past = new Date(now.getTime() - 10 * 60 * 1000);

        const { data: appts, error } = await supabaseAdmin
          .from("appointments")
          .select("*")
          .in("status", ["scheduled", "confirmed"])
          .gte("appointment_datetime", past.toISOString())
          .lte("appointment_datetime", horizon.toISOString())
          .order("appointment_datetime", { ascending: true });

        if (error) {
          console.error("REMINDER_SCAN_FAILED", error);
          return Response.json({ ok: false, error: error.message }, { status: 500 });
        }

        const summary: any[] = [];

        for (const a of appts ?? []) {
          if (!a.appointment_datetime) continue;
          const apptDt = new Date(a.appointment_datetime);
          const msUntil = apptDt.getTime() - now.getTime();
          if (msUntil < -5 * 60 * 1000) continue; // already past

          const phone = extractWhatsappSendNumber(a.phone);
          if (!phone) {
            console.warn("REMINDER_SKIP_INVALID_PHONE", { appointment_id: a.id, phone: a.phone });
            continue;
          }

          for (const tierDef of REMINDER_TIERS) {
            const alreadySent = (a as any)[tierDef.flag] === true;
            if (alreadySent) continue;
            if (msUntil > tierDef.offsetMs) continue; // not yet within window

            const name = a.name ?? "there";
            const message = reminderMessage(tierDef.tier, name, apptDt);
            const result = await sendViaVps(phone, message);

            await supabaseAdmin.from("bot_logs").insert({
              workspace_id: a.workspace_id,
              bot_name: "appointment-reminder",
              channel: "whatsapp",
              level: result.ok ? "info" : "error",
              message: `${tierDef.logCode} ${result.ok ? "ok" : "failed"} -> ${phone}`,
              metadata: {
                appointment_id: a.id,
                tier: tierDef.tier,
                phone,
                message,
                vps_status: result.status,
                vps_body: result.body,
                cron: true,
              },
            });

            if (result.ok) {
              await supabaseAdmin
                .from("appointments")
                .update({ [tierDef.flag]: true })
                .eq("id", a.id);
            }

            summary.push({
              appointment_id: a.id,
              tier: tierDef.tier,
              phone,
              ok: result.ok,
              status: result.status,
            });
          }
        }

        console.log("REMINDER_SCAN_COMPLETE", { scanned: appts?.length ?? 0, sent: summary.length });
        return Response.json({ ok: true, scanned: appts?.length ?? 0, dispatched: summary });
      },
    },
  },
});
