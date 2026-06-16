import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Stage = "new" | "interested" | "appointment_booked" | "proposal" | "negotiation" | "won" | "lost";

const STAGE_ORDER: Record<string, number> = {
  new: 0, contacted: 1, qualified: 2, interested: 3,
  appointment_booked: 4, proposal: 5, negotiation: 6, won: 7, lost: 7,
};

function detectStageFromText(text: string | null | undefined): Stage | null {
  if (!text) return null;
  const t = text.toLowerCase();
  if (/\b(paid|payment\s*(done|received|sent|made)|transferred|deposited)\b/i.test(t)) return "won";
  if (/\b(not\s*interested|don'?t\s*need|cancel(?:led)?|no\s*thanks?|එපා|வேண்டாம்)\b/i.test(t)) return "lost";
  if (/\b(discount|negotiate|lower\s*price|reduce|cheaper|best\s*price|final\s*price)\b/i.test(t)) return "negotiation";
  if (/\b(quotation|proposal|quote|invoice)\b/i.test(t)) return "proposal";
  if (/\b(price|cost|how\s*much|rate|charges?|fee|pricing|details|මිල|ගණන|விலை)\b/i.test(t)) return "interested";
  return null;
}

function detectServiceInterest(text: string | null | undefined): string | null {
  if (!text) return null;
  const t = text.toLowerCase();
  const m = t.match(/\b(website|web\s*site|app|mobile\s*app|seo|marketing|social\s*media|ads?|facebook|instagram|whatsapp\s*bot|chatbot|design|logo|branding|ecommerce|e-commerce)\b/);
  return m ? m[1] : null;
}

export const syncConversationsToCrm = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: profile } = await context.supabase
      .from("profiles").select("workspace_id").eq("id", context.userId).single();
    if (!profile?.workspace_id) throw new Error("Workspace not found");
    const workspaceId = profile.workspace_id;

    const { data: convs, error: convErr } = await context.supabase
      .from("conversations")
      .select("id, contact_id, remote_jid, whatsapp_number, sender_number, last_message_at")
      .eq("workspace_id", workspaceId);
    if (convErr) throw convErr;

    let created = 0, updated = 0, skipped = 0, removed = 0;

    for (const conv of convs ?? []) {
      if (!conv.contact_id) { skipped++; continue; }
      const { data: contact } = await context.supabase
        .from("contacts").select("id, name, phone, whatsapp_number, sender_number, remote_jid").eq("id", conv.contact_id).maybeSingle();
      if (!contact) { skipped++; continue; }

      const phone = contact.phone || contact.whatsapp_number || contact.sender_number
        || conv.whatsapp_number || conv.sender_number
        || (conv.remote_jid?.split("@")[0] ?? null) || (contact.remote_jid?.split("@")[0] ?? null);
      const name = contact.name || phone || null;

      // Last inbound message (for last_message + stage detection + service interest)
      const { data: lastMsgs } = await context.supabase
        .from("messages")
        .select("body, direction, created_at")
        .eq("conversation_id", conv.id)
        .order("created_at", { ascending: false })
        .limit(20);
      const lastAny = lastMsgs?.[0]?.body ?? null;
      const lastInbound = (lastMsgs ?? []).find((m: any) => m.direction === "inbound")?.body ?? null;
      const service = detectServiceInterest(lastInbound);
      const detectedStage = detectStageFromText(lastInbound);

      // Existing lead
      const { data: existing } = await context.supabase
        .from("leads").select("id, name, phone, stage, service_interest, source").eq("contact_id", contact.id).maybeSingle();

      if (!existing) {
        const stage: Stage = detectedStage ?? "new";
        const { error } = await context.supabase.from("leads").insert({
          workspace_id: workspaceId,
          contact_id: contact.id,
          name, phone,
          source: "whatsapp",
          stage,
          service_interest: service,
          last_message: lastAny,
        } as any);
        if (!error) created++;
      } else {
        const patch: any = {};
        if (!existing.name && name) patch.name = name;
        if (!existing.phone && phone) patch.phone = phone;
        if (!existing.source) patch.source = "whatsapp";
        if (!existing.service_interest && service) patch.service_interest = service;
        if (lastAny !== undefined) patch.last_message = lastAny;
        if (detectedStage) {
          const cur = existing.stage ?? "new";
          const isTerminal = cur === "won" || cur === "lost";
          if (!isTerminal && (detectedStage === "won" || detectedStage === "lost"
            || (STAGE_ORDER[detectedStage] ?? 0) > (STAGE_ORDER[cur] ?? 0))) {
            patch.stage = detectedStage;
          }
        }
        if (Object.keys(patch).length > 0) {
          const { error } = await context.supabase.from("leads").update(patch).eq("id", existing.id);
          if (!error) updated++;
        }
      }
    }

    // Remove untitled junk leads (no name, no phone, no contact)
    const { data: junk } = await context.supabase
      .from("leads").select("id, name, phone, contact_id")
      .eq("workspace_id", workspaceId)
      .is("contact_id", null);
    for (const l of junk ?? []) {
      if (!l.name && !l.phone) {
        await context.supabase.from("leads").delete().eq("id", l.id);
        removed++;
      }
    }

    // Backfill names for leads where name is missing but contact has phone/name
    const { data: untitled } = await context.supabase
      .from("leads").select("id, contact_id, name, phone").eq("workspace_id", workspaceId).is("name", null);
    for (const l of untitled ?? []) {
      if (!l.contact_id) continue;
      const { data: c } = await context.supabase
        .from("contacts").select("name, phone, whatsapp_number").eq("id", l.contact_id).maybeSingle();
      const nm = c?.name || c?.phone || c?.whatsapp_number || l.phone;
      if (nm) {
        await context.supabase.from("leads").update({ name: nm, phone: l.phone || c?.phone || c?.whatsapp_number || null }).eq("id", l.id);
        updated++;
      }
    }

    return { created, updated, skipped, removed, scanned: convs?.length ?? 0 };
  });
