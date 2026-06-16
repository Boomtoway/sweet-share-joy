import { createFileRoute } from "@tanstack/react-router";
import { sendViaVps, extractWhatsappSendNumber } from "@/lib/vps/send";

// Cron-invoked. Sends payment reminders:
//   - 3 days before due_date
//   - On due date
//   - After overdue (daily, capped at 3)
export const Route = createFileRoute("/api/public/hooks/invoice-reminders")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: invoices, error } = await supabaseAdmin
          .from("invoices")
          .select("*")
          .in("status", ["sent", "partially_paid", "overdue"])
          .gt("balance_amount", 0);
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const summary: any[] = [];

        for (const inv of invoices ?? []) {
          if (!inv.due_date) continue;
          const due = new Date(inv.due_date);
          due.setHours(0, 0, 0, 0);
          const diffDays = Math.round((due.getTime() - today.getTime()) / 86400000);

          let stage: string | null = null;
          if (diffDays === 3) stage = "pre_due_3d";
          else if (diffDays === 0) stage = "due_today";
          else if (diffDays < 0) stage = `overdue_d${Math.min(Math.abs(diffDays), 3)}`;
          if (!stage) continue;

          if (inv.reminder_stage === stage) continue; // already sent for this stage

          const phone = extractWhatsappSendNumber(inv.phone);
          if (!phone) continue;

          const amount = Number(inv.balance_amount ?? 0).toLocaleString();
          const due_str = due.toLocaleDateString();
          let msg = "";
          if (stage === "pre_due_3d") {
            msg = `Hi ${inv.customer_name ?? "there"},\n\nReminder: Invoice ${inv.invoice_number} (LKR ${amount}) is due on ${due_str}.\n\nThank you,\nStartAppLK`;
          } else if (stage === "due_today") {
            msg = `Hi ${inv.customer_name ?? "there"},\n\nInvoice ${inv.invoice_number} of LKR ${amount} is due today.\n\nThank you,\nStartAppLK`;
          } else {
            msg = `Hi ${inv.customer_name ?? "there"},\n\nInvoice ${inv.invoice_number} of LKR ${amount} is overdue (was due ${due_str}). Please settle at your earliest convenience.\n\nThank you,\nStartAppLK`;
          }

          const result = await sendViaVps(phone, msg);

          await (supabaseAdmin as any).from("bot_logs").insert({
            workspace_id: inv.workspace_id,
            bot_name: "invoice-reminder",
            channel: "whatsapp",
            level: result.ok ? "info" : "error",
            message: `INVOICE_REMINDER ${stage} ${result.ok ? "ok" : "failed"} -> ${phone}`,
            metadata: { invoice_id: inv.id, stage, vps_status: result.status, vps_body: result.body },
          } as any);

          if (result.ok) {
            await (supabaseAdmin as any).from("invoices").update({
              last_reminder_at: new Date().toISOString(),
              reminder_stage: stage,
            } as any).eq("id", inv.id);
          }

          summary.push({ invoice_id: inv.id, stage, ok: result.ok });
        }

        return Response.json({ ok: true, scanned: invoices?.length ?? 0, dispatched: summary });
      },
    },
  },
});
