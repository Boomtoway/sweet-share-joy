import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { sendViaVps, extractWhatsappSendNumber } from "@/lib/vps/send";

type CreateFromLeadInput = {
  lead_id: string;
  amount?: number;
  due_date?: string | null;
  notes?: string | null;
};

async function nextInvoiceNumber(supabase: any, workspaceId: string): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;
  const { data } = await supabase
    .from("invoices")
    .select("invoice_number")
    .eq("workspace_id", workspaceId)
    .like("invoice_number", `${prefix}%`)
    .order("invoice_number", { ascending: false })
    .limit(1);
  let next = 1;
  const last = data?.[0]?.invoice_number as string | undefined;
  if (last) {
    const n = parseInt(last.slice(prefix.length), 10);
    if (!Number.isNaN(n)) next = n + 1;
  }
  return `${prefix}${String(next).padStart(3, "0")}`;
}

export const createInvoiceFromLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: CreateFromLeadInput) => d)
  .handler(async ({ data, context }) => {
    const { data: profile } = await context.supabase
      .from("profiles").select("workspace_id").eq("id", context.userId).single();
    if (!profile?.workspace_id) throw new Error("Workspace not found");
    const workspaceId = profile.workspace_id;

    const { data: lead, error: leadErr } = await context.supabase
      .from("leads").select("*").eq("id", data.lead_id).single();
    if (leadErr || !lead) throw new Error("Lead not found");

    const amount = Number(data.amount ?? lead.deal_value ?? lead.value ?? 0);
    const invoice_number = await nextInvoiceNumber(context.supabase, workspaceId);

    const { data: inv, error } = await context.supabase
      .from("invoices")
      .insert({
        workspace_id: workspaceId,
        lead_id: lead.id,
        customer_name: lead.name,
        phone: lead.phone,
        service: lead.service_interest,
        invoice_number,
        amount,
        paid_amount: 0,
        status: "draft",
        due_date: data.due_date ?? null,
        notes: data.notes ?? null,
      } as any)
      .select("*").single();
    if (error) throw error;
    return inv;
  });

export const sendInvoiceWhatsapp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { invoice_id: string }) => d)
  .handler(async ({ data, context }) => {
    const { data: inv, error } = await context.supabase
      .from("invoices").select("*").eq("id", data.invoice_id).single();
    if (error || !inv) throw new Error("Invoice not found");

    const phone = extractWhatsappSendNumber(inv.phone);
    if (!phone) throw new Error("Invalid WhatsApp number on invoice");

    const due = inv.due_date ? new Date(inv.due_date).toLocaleDateString() : "—";
    const amount = Number(inv.amount ?? 0).toLocaleString();
    const message =
`Hi ${inv.customer_name ?? "there"},

Your invoice is ready.

Invoice No: ${inv.invoice_number}
Service: ${inv.service ?? "—"}
Amount: LKR ${amount}
Due Date: ${due}

Thank you,
StartAppLK`;

    const result = await sendViaVps(phone, message);

    await context.supabase.from("bot_logs").insert({
      workspace_id: inv.workspace_id,
      bot_name: "invoice-send",
      channel: "whatsapp",
      level: result.ok ? "info" : "error",
      message: `INVOICE_SEND ${result.ok ? "ok" : "failed"} -> ${phone}`,
      metadata: { invoice_id: inv.id, phone, vps_status: result.status, vps_body: result.body },
    } as any);

    if (result.ok) {
      const patch: any = { sent_at: new Date().toISOString() };
      if (inv.status === "draft") patch.status = "sent";
      await context.supabase.from("invoices").update(patch).eq("id", inv.id);
    }
    return { ok: result.ok, status: result.status };
  });
