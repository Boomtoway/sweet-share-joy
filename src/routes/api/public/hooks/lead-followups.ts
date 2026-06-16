import { createFileRoute } from "@tanstack/react-router";
import { sendViaVps, extractWhatsappSendNumber } from "@/lib/vps/send";
import { tiersFor, followupMessage, PROD_FOLLOWUP_TIERS, TEST_FOLLOWUP_TIERS, type FollowupType } from "@/lib/followups/followups";

// Cron-invoked every 30 minutes:
//   1. Scan open conversations whose last activity is past a tier threshold.
//      For each tier (day_1, day_3, day_7) — if no existing pending/sent
//      follow-up of that type, insert one (log FOLLOWUP_CREATED).
//   2. Dispatch any pending follow-ups whose scheduled_at <= now.
//
// Unique partial index on (conversation_id, followup_type) WHERE status IN
// ('pending','sent') prevents duplicates even on concurrent runs.
export const Route = createFileRoute("/api/public/hooks/lead-followups")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const now = new Date();

        // --- Step 1: schedule new follow-ups ---
        const oldestThreshold = new Date(now.getTime() - FOLLOWUP_TIERS[0].thresholdMs);
        const { data: convs, error: convErr } = await supabaseAdmin
          .from("conversations")
          .select("id, workspace_id, contact_id, last_message_at, status, contact:contacts(id, name, phone, whatsapp_number, sender_number, remote_jid, human_takeover, is_blacklisted)")
          .eq("status", "open")
          .not("last_message_at", "is", null)
          .lte("last_message_at", oldestThreshold.toISOString())
          .limit(500);

        if (convErr) {
          console.error("FOLLOWUP_SCAN_FAILED", convErr);
          return Response.json({ ok: false, error: convErr.message }, { status: 500 });
        }

        const created: any[] = [];

        for (const c of convs ?? []) {
          const contact: any = (c as any).contact;
          if (!contact || contact.human_takeover || contact.is_blacklisted) continue;

          const phone = extractWhatsappSendNumber(
            contact.whatsapp_number,
            contact.sender_number,
            contact.phone,
            contact.remote_jid,
          );
          if (!phone) continue;

          // Confirm last inbound from contact is indeed older than threshold
          // (last_message_at also bumps on our outbound sends, so verify direction).
          const { data: lastInbound } = await supabaseAdmin
            .from("messages")
            .select("created_at")
            .eq("conversation_id", c.id)
            .eq("direction", "inbound")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (!lastInbound) continue;
          const idleMs = now.getTime() - new Date(lastInbound.created_at).getTime();

          // Pick the highest tier the customer qualifies for that isn't already
          // scheduled or sent.
          const { data: existing } = await supabaseAdmin
            .from("lead_followups")
            .select("followup_type, status")
            .eq("conversation_id", c.id)
            .in("status", ["pending", "sent"]);
          const taken = new Set((existing ?? []).map((r: any) => r.followup_type));

          for (const tier of FOLLOWUP_TIERS) {
            if (idleMs < tier.thresholdMs) continue;
            if (taken.has(tier.type)) continue;

            const name = contact.name ?? "there";
            const message = followupMessage(tier.type as FollowupType, name);

            const { data: inserted, error: insErr } = await supabaseAdmin
              .from("lead_followups")
              .insert({
                workspace_id: (c as any).workspace_id,
                contact_id: contact.id,
                conversation_id: c.id,
                phone,
                followup_type: tier.type,
                message,
                scheduled_at: now.toISOString(),
                status: "pending",
              })
              .select()
              .single();

            // 23505 = unique violation from the dedupe index → race with another run
            if (insErr) {
              if (insErr.code !== "23505") console.error("FOLLOWUP_INSERT_FAILED", insErr);
              continue;
            }

            await supabaseAdmin.from("bot_logs").insert({
              workspace_id: (c as any).workspace_id,
              bot_name: "lead-followup",
              channel: "whatsapp",
              level: "info",
              message: `FOLLOWUP_CREATED ${tier.type} -> ${phone}`,
              metadata: { followup_id: inserted.id, conversation_id: c.id, type: tier.type, idle_hours: Math.round(idleMs / 3_600_000) },
            });
            created.push({ id: inserted.id, type: tier.type, phone });
          }
        }

        // --- Step 2: dispatch due follow-ups ---
        const { data: due, error: dueErr } = await supabaseAdmin
          .from("lead_followups")
          .select("*")
          .eq("status", "pending")
          .lte("scheduled_at", now.toISOString())
          .limit(200);

        if (dueErr) {
          console.error("FOLLOWUP_DUE_FETCH_FAILED", dueErr);
          return Response.json({ ok: true, created: created.length, dispatched: 0, error: dueErr.message });
        }

        const dispatched: any[] = [];
        for (const f of due ?? []) {
          const phone = extractWhatsappSendNumber(f.phone);
          if (!phone) {
            await supabaseAdmin
              .from("lead_followups")
              .update({ status: "failed", error: "invalid phone" })
              .eq("id", f.id);
            continue;
          }

          const result = await sendViaVps(phone, f.message);

          await supabaseAdmin.from("bot_logs").insert({
            workspace_id: f.workspace_id,
            bot_name: "lead-followup",
            channel: "whatsapp",
            level: result.ok ? "info" : "error",
            message: `${result.ok ? "FOLLOWUP_SENT" : "FOLLOWUP_FAILED"} ${f.followup_type} -> ${phone}`,
            metadata: {
              followup_id: f.id,
              conversation_id: f.conversation_id,
              type: f.followup_type,
              vps_status: result.status,
              vps_body: result.body,
              cron: true,
            },
          });

          await supabaseAdmin
            .from("lead_followups")
            .update({
              status: result.ok ? "sent" : "failed",
              sent_at: result.ok ? now.toISOString() : null,
              error: result.ok ? null : (result.error ?? `VPS ${result.status}`),
            })
            .eq("id", f.id);

          dispatched.push({ id: f.id, ok: result.ok, type: f.followup_type, phone });
        }

        console.log("FOLLOWUP_SCAN_COMPLETE", { created: created.length, dispatched: dispatched.length });
        return Response.json({ ok: true, created, dispatched });
      },
    },
  },
});
