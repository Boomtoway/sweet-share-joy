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

function normalizePhone(p: string | null | undefined): string | null {
  if (!p) return null;
  const digits = String(p).replace(/\D/g, "");
  return digits.length >= 9 ? digits : null;
}

function extractServiceFromMessages(msgs: { body: string | null; direction: string }[]): string | null {
  for (const m of msgs) {
    if (m.direction !== "inbound") continue;
    const s = detectServiceInterest(m.body);
    if (s) return s;
  }
  return null;
}

export const repairCrmData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: profile } = await context.supabase
      .from("profiles").select("workspace_id").eq("id", context.userId).single();
    if (!profile?.workspace_id) throw new Error("Workspace not found");
    const workspaceId = profile.workspace_id;

    let namesUpdated = 0, phonesUpdated = 0, duplicatesRemoved = 0,
        deletedEmpty = 0, lastMessagesUpdated = 0, servicesUpdated = 0,
        leadsCreated = 0;

    // 1) Pull conversations & contacts; build a phone -> best contact/conv map
    const { data: convs } = await context.supabase
      .from("conversations")
      .select("id, contact_id, remote_jid, whatsapp_number, sender_number, last_message_at")
      .eq("workspace_id", workspaceId);
    const { data: contacts } = await context.supabase
      .from("contacts")
      .select("id, name, phone, whatsapp_number, sender_number, remote_jid")
      .eq("workspace_id", workspaceId);

    const contactById = new Map<string, any>();
    for (const c of contacts ?? []) contactById.set(c.id, c);

    // 2) For every conversation, derive phone + name + ensure a single lead per phone
    const phoneToLeadId = new Map<string, string>();
    const { data: allLeads } = await context.supabase
      .from("leads")
      .select("id, contact_id, name, phone, stage, service_interest, last_message, value, notes")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true });

    // Index leads by phone for merge
    for (const l of allLeads ?? []) {
      const p = normalizePhone(l.phone);
      if (p && !phoneToLeadId.has(p)) phoneToLeadId.set(p, l.id);
    }

    for (const conv of convs ?? []) {
      const contact = conv.contact_id ? contactById.get(conv.contact_id) : null;
      const phone = normalizePhone(
        contact?.phone || contact?.whatsapp_number || contact?.sender_number ||
        conv.whatsapp_number || conv.sender_number ||
        conv.remote_jid?.split("@")[0] || contact?.remote_jid?.split("@")[0]
      );
      const name = (contact?.name && contact.name.trim()) || phone || null;
      if (!phone && !name) continue;

      // latest messages for last_message + service detection + stage
      const { data: msgs } = await context.supabase
        .from("messages")
        .select("body, direction, created_at")
        .eq("conversation_id", conv.id)
        .order("created_at", { ascending: false })
        .limit(30);
      const lastAny = msgs?.[0]?.body ?? null;
      const lastInbound = (msgs ?? []).find((m: any) => m.direction === "inbound")?.body ?? null;
      const service = extractServiceFromMessages(msgs ?? []);
      const detectedStage = detectStageFromText(lastInbound);

      // Find lead: prefer by phone, fall back to contact_id
      let leadId = (phone && phoneToLeadId.get(phone)) || null;
      if (!leadId && contact?.id) {
        const existing = (allLeads ?? []).find((l) => l.contact_id === contact.id);
        if (existing) leadId = existing.id;
      }

      if (!leadId) {
        const stage: Stage = detectedStage ?? "new";
        const { data: ins } = await context.supabase.from("leads").insert({
          workspace_id: workspaceId,
          contact_id: contact?.id ?? null,
          name, phone,
          source: "whatsapp",
          stage,
          service_interest: service,
          last_message: lastAny,
        } as any).select("id").single();
        if (ins?.id) {
          leadsCreated++;
          if (phone) phoneToLeadId.set(phone, ins.id);
        }
        continue;
      }

      // Update existing — force fill name/phone from contact when missing or generic
      const lead = (allLeads ?? []).find((l) => l.id === leadId)!;
      const patch: any = {};
      const isGenericName = !lead.name || lead.name.trim() === "" || lead.name === "Lead" || lead.name === "Untitled";
      if (isGenericName && name) { patch.name = name; namesUpdated++; }
      if (!lead.phone && phone) { patch.phone = phone; phonesUpdated++; }
      if (!lead.contact_id && contact?.id) patch.contact_id = contact.id;
      if (lastAny && lead.last_message !== lastAny) { patch.last_message = lastAny; lastMessagesUpdated++; }
      if (!lead.service_interest && service) { patch.service_interest = service; servicesUpdated++; }
      if (detectedStage) {
        const cur = lead.stage ?? "new";
        const terminal = cur === "won" || cur === "lost";
        if (!terminal && (detectedStage === "won" || detectedStage === "lost"
            || (STAGE_ORDER[detectedStage] ?? 0) > (STAGE_ORDER[cur] ?? 0))) {
          patch.stage = detectedStage;
        }
      }
      if (Object.keys(patch).length) {
        await context.supabase.from("leads").update(patch).eq("id", leadId);
        Object.assign(lead, patch);
      }
    }

    // 3) Merge duplicate leads by phone (keep first; merge value, notes; delete extras)
    const { data: leadsAfter } = await context.supabase
      .from("leads")
      .select("id, phone, name, value, notes, last_message, service_interest, stage, created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true });
    const groups = new Map<string, any[]>();
    for (const l of leadsAfter ?? []) {
      const p = normalizePhone(l.phone);
      if (!p) continue;
      if (!groups.has(p)) groups.set(p, []);
      groups.get(p)!.push(l);
    }
    for (const [, group] of groups) {
      if (group.length < 2) continue;
      const keep = group[0];
      const dups = group.slice(1);
      const totalValue = group.reduce((s, l) => s + Number(l.value ?? 0), 0);
      const mergedNotes = group.map((l) => l.notes).filter(Boolean).join("\n---\n") || null;
      const lastMessage = dups.find((d) => d.last_message)?.last_message || keep.last_message;
      const service = keep.service_interest || dups.find((d) => d.service_interest)?.service_interest || null;
      await context.supabase.from("leads").update({
        value: totalValue,
        notes: mergedNotes,
        last_message: lastMessage,
        service_interest: service,
      }).eq("id", keep.id);
      const dupIds = dups.map((d) => d.id);
      await context.supabase.from("leads").delete().in("id", dupIds);
      duplicatesRemoved += dups.length;
    }

    // 4) Delete empty leads: no name, no phone, no contact_id, no value, no notes
    const { data: emptyLeads } = await context.supabase
      .from("leads")
      .select("id, name, phone, contact_id, value, notes, last_message")
      .eq("workspace_id", workspaceId);
    const toDelete = (emptyLeads ?? []).filter((l) =>
      !l.name && !l.phone && !l.contact_id && (!l.value || Number(l.value) === 0) && !l.notes && !l.last_message
    ).map((l) => l.id);
    if (toDelete.length) {
      await context.supabase.from("leads").delete().in("id", toDelete);
      deletedEmpty = toDelete.length;
    }

    // 5) Final pass: any lead with empty name but a contact_id → pull contact.name/phone
    const { data: needsName } = await context.supabase
      .from("leads")
      .select("id, contact_id, name, phone")
      .eq("workspace_id", workspaceId)
      .or("name.is.null,name.eq.");
    for (const l of needsName ?? []) {
      if (!l.contact_id) continue;
      const c = contactById.get(l.contact_id);
      if (!c) continue;
      const p = normalizePhone(c.phone || c.whatsapp_number || c.remote_jid?.split("@")[0]);
      const nm = (c.name && c.name.trim()) || p || null;
      if (nm) {
        await context.supabase.from("leads").update({
          name: nm,
          phone: l.phone || p,
        }).eq("id", l.id);
        namesUpdated++;
      }
    }

    return {
      conversations_scanned: convs?.length ?? 0,
      leads_created: leadsCreated,
      names_updated: namesUpdated,
      phones_updated: phonesUpdated,
      last_messages_updated: lastMessagesUpdated,
      services_updated: servicesUpdated,
      duplicates_removed: duplicatesRemoved,
      empty_leads_deleted: deletedEmpty,
    };
  });
