import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const getMyBilling = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: sub } = await supabaseAdmin
      .from("subscriptions")
      .select("id, plan, status, start_date, expiry_date, price_lkr, max_bots, max_messages")
      .eq("client_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: slips } = await supabaseAdmin
      .from("payment_slips")
      .select("id, type, storage_path, amount, note, status, created_at")
      .eq("client_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(20);

    const latest = (slips ?? []).find((s) => s.type === "slip") ?? null;
    const paymentStatus = latest?.status ?? (sub?.status === "active" ? "paid" : "unpaid");

    return { subscription: sub, slips: slips ?? [], paymentStatus };
  });

export const requestRenewal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { note?: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: sub } = await supabaseAdmin
      .from("subscriptions")
      .select("id")
      .eq("client_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { error } = await supabaseAdmin.from("payment_slips").insert({
      client_id: context.userId,
      subscription_id: sub?.id ?? null,
      type: "renewal_request",
      note: data.note ?? null,
      status: "pending",
    });
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("admin_notifications").insert({
      title: "Renewal requested",
      message: `Client ${context.userId} requested a subscription renewal.`,
      type: "renewal_request",
      metadata: { client_id: context.userId },
    });

    return { ok: true };
  });

export const recordPaymentSlip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { storage_path: string; amount?: number; note?: string }) =>
    z.object({
      storage_path: z.string().min(1),
      amount: z.number().optional(),
      note: z.string().optional(),
    }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: sub } = await supabaseAdmin
      .from("subscriptions")
      .select("id")
      .eq("client_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { error } = await supabaseAdmin.from("payment_slips").insert({
      client_id: context.userId,
      subscription_id: sub?.id ?? null,
      type: "slip",
      storage_path: data.storage_path,
      amount: data.amount ?? null,
      note: data.note ?? null,
      status: "pending",
    });
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("admin_notifications").insert({
      title: "Payment slip uploaded",
      message: `Client ${context.userId} uploaded a payment slip.`,
      type: "payment_slip",
      metadata: { client_id: context.userId, storage_path: data.storage_path },
    });

    return { ok: true };
  });

export const createPaymentRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    amount: number;
    reference_number: string;
    bank_name: string;
    slip_path: string;
    note?: string;
  }) =>
    z.object({
      amount: z.number().positive(),
      reference_number: z.string().trim().min(1).max(100),
      bank_name: z.string().trim().min(1).max(100),
      slip_path: z.string().min(1),
      note: z.string().max(500).optional(),
    }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("workspace_id")
      .eq("id", context.userId)
      .maybeSingle();
    const { data: sub } = await supabaseAdmin
      .from("subscriptions")
      .select("id")
      .eq("client_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: inserted, error } = await supabaseAdmin
      .from("payment_requests")
      .insert({
        client_id: context.userId,
        workspace_id: profile?.workspace_id ?? null,
        subscription_id: sub?.id ?? null,
        amount: data.amount,
        reference_number: data.reference_number,
        bank_name: data.bank_name,
        slip_path: data.slip_path,
        note: data.note ?? null,
        status: "pending",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("admin_notifications").insert({
      title: "Payment slip uploaded",
      message: `Client ${context.userId} submitted a payment of LKR ${data.amount} (Ref: ${data.reference_number}).`,
      type: "payment_request",
      metadata: {
        client_id: context.userId,
        payment_request_id: inserted.id,
        slip_path: data.slip_path,
      },
    });

    return { ok: true, id: inserted.id };
  });

export const getSlipSignedUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { path: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // ensure ownership
    if (!data.path.startsWith(`${context.userId}/`)) {
      const { data: admin } = await context.supabase.rpc("has_role", {
        _user_id: context.userId,
        _role: "admin",
      });
      if (!admin) throw new Error("Forbidden");
    }
    const { data: signed, error } = await supabaseAdmin.storage
      .from("payment-slips")
      .createSignedUrl(data.path, 60 * 10);
    if (error) throw new Error(error.message);
    return { url: signed.signedUrl };
  });
