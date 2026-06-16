import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function assertAdmin(context: any) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin only");
}

export const listPaymentSlips = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: slips, error } = await supabaseAdmin
      .from("payment_slips")
      .select(
        "id, client_id, subscription_id, type, storage_path, amount, note, status, created_at"
      )
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const ids = Array.from(new Set((slips ?? []).map((s) => s.client_id)));
    let profiles: any[] = [];
    if (ids.length) {
      const { data } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, email, business_name")
        .in("id", ids);
      profiles = data ?? [];
    }
    const pMap = new Map(profiles.map((p) => [p.id, p]));
    const enriched = (slips ?? []).map((s) => ({
      ...s,
      profile: pMap.get(s.client_id) ?? null,
    }));

    const stats = {
      pending: enriched.filter((s) => s.status === "pending").length,
      approved: enriched.filter((s) => s.status === "approved").length,
      rejected: enriched.filter((s) => s.status === "rejected").length,
      total: enriched.length,
    };
    return { slips: enriched, stats };
  });

export const approvePaymentSlip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: slip, error: sErr } = await supabaseAdmin
      .from("payment_slips")
      .select("id, client_id, subscription_id, status")
      .eq("id", data.id)
      .maybeSingle();
    if (sErr) throw new Error(sErr.message);
    if (!slip) throw new Error("Slip not found");

    // Mark slip approved
    await supabaseAdmin
      .from("payment_slips")
      .update({ status: "approved" })
      .eq("id", slip.id);

    // Find subscription (use slip.subscription_id or latest for client)
    let subId = slip.subscription_id as string | null;
    let currentExpiry: string | null = null;
    if (subId) {
      const { data: s } = await supabaseAdmin
        .from("subscriptions")
        .select("id, expiry_date")
        .eq("id", subId)
        .maybeSingle();
      currentExpiry = s?.expiry_date ?? null;
    } else {
      const { data: s } = await supabaseAdmin
        .from("subscriptions")
        .select("id, expiry_date")
        .eq("client_id", slip.client_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      subId = s?.id ?? null;
      currentExpiry = s?.expiry_date ?? null;
    }

    if (subId) {
      const base = currentExpiry ? new Date(currentExpiry).getTime() : 0;
      const start = Math.max(base, Date.now());
      const newExpiry = new Date(start + 30 * 86400000).toISOString();
      await supabaseAdmin
        .from("subscriptions")
        .update({ status: "active", expiry_date: newExpiry })
        .eq("id", subId);
    }

    await supabaseAdmin.from("admin_notifications").insert({
      title: "Payment approved",
      message: `Payment for client ${slip.client_id} approved. Subscription extended by 30 days.`,
      type: "payment_approved",
      metadata: { client_id: slip.client_id, slip_id: slip.id, subscription_id: subId },
    });

    return { ok: true };
  });

export const rejectPaymentSlip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; reason?: string }) =>
    z.object({ id: z.string().uuid(), reason: z.string().optional() }).parse(d)
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: slip } = await supabaseAdmin
      .from("payment_slips")
      .select("id, client_id, note")
      .eq("id", data.id)
      .maybeSingle();
    if (!slip) throw new Error("Slip not found");

    const newNote = data.reason
      ? `${slip.note ? slip.note + " | " : ""}Rejected: ${data.reason}`
      : slip.note;

    await supabaseAdmin
      .from("payment_slips")
      .update({ status: "rejected", note: newNote })
      .eq("id", slip.id);

    await supabaseAdmin.from("admin_notifications").insert({
      title: "Payment rejected",
      message: `Payment for client ${slip.client_id} was rejected.${
        data.reason ? ` Reason: ${data.reason}` : ""
      }`,
      type: "payment_rejected",
      metadata: { client_id: slip.client_id, slip_id: slip.id, reason: data.reason ?? null },
    });

    return { ok: true };
  });

export const getAdminSlipUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { path: string }) => z.object({ path: z.string().min(1) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed, error } = await supabaseAdmin.storage
      .from("payment-slips")
      .createSignedUrl(data.path, 60 * 10);
    if (error) throw new Error(error.message);
    return { url: signed.signedUrl };
  });
