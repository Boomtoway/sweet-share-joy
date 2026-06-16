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

const PLAN_DEFAULTS: Record<string, { price: number; bots: number | null; msgs: number | null }> = {
  starter: { price: 9900, bots: 1, msgs: 500 },
  growth: { price: 19900, bots: 3, msgs: 3000 },
  agency: { price: 49900, bots: null, msgs: null },
};

export const listSubscriptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: subs, error } = await supabaseAdmin
      .from("subscriptions")
      .select("id, client_id, plan, status, price_lkr, start_date, expiry_date, max_bots, max_messages, created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const ids = Array.from(new Set((subs ?? []).map((s) => s.client_id)));
    let profiles: any[] = [];
    if (ids.length) {
      const { data: p } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, email, business_name")
        .in("id", ids);
      profiles = p ?? [];
    }
    const pMap = new Map(profiles.map((p) => [p.id, p]));
    const enriched = (subs ?? []).map((s) => ({ ...s, profile: pMap.get(s.client_id) ?? null }));

    const now = Date.now();
    const in30 = now + 30 * 86400000;
    const activeClients = new Set<string>();
    const expiredClients = new Set<string>();
    let monthlyRevenue = 0;
    let renewalsDue = 0;
    for (const s of enriched) {
      if (s.status === "active") {
        activeClients.add(s.client_id);
        monthlyRevenue += s.price_lkr ?? 0;
        const exp = s.expiry_date ? new Date(s.expiry_date).getTime() : null;
        if (exp && exp <= in30) renewalsDue += 1;
      }
      if (s.status === "expired") expiredClients.add(s.client_id);
      if (s.expiry_date && new Date(s.expiry_date).getTime() < now && s.status === "active") {
        renewalsDue += 0; // already counted above if within 30d
      }
    }

    return {
      subscriptions: enriched,
      stats: {
        active_clients: activeClients.size,
        expired_clients: expiredClients.size,
        monthly_revenue: monthlyRevenue,
        renewals_due: renewalsDue,
      },
    };
  });

const updateSchema = z.object({
  id: z.string().uuid(),
  plan: z.enum(["starter", "growth", "agency"]).optional(),
  status: z.enum(["active", "expired", "cancelled"]).optional(),
  expiry_date: z.string().datetime().optional().nullable(),
  price_lkr: z.number().int().min(0).optional(),
  max_bots: z.number().int().min(0).optional().nullable(),
  max_messages: z.number().int().min(0).optional().nullable(),
});

export const updateSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => updateSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { id, ...rest } = data;
    // If plan changes and limits/price not provided, apply defaults.
    if (rest.plan && PLAN_DEFAULTS[rest.plan]) {
      const def = PLAN_DEFAULTS[rest.plan];
      if (rest.price_lkr === undefined) rest.price_lkr = def.price;
      if (rest.max_bots === undefined) rest.max_bots = def.bots;
      if (rest.max_messages === undefined) rest.max_messages = def.msgs;
    }
    const { error } = await supabaseAdmin.from("subscriptions").update(rest).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const idSchema = z.object({ id: z.string().uuid() });

export const deleteSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => idSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("subscriptions").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
