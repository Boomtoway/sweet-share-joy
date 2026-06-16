import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(context: any) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin only");
}

const PLAN_LABEL: Record<string, string> = {
  starter: "Starter",
  growth: "Growth",
  agency: "Agency",
};

export const getRevenueAnalytics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: subs, error } = await supabaseAdmin
      .from("subscriptions")
      .select("id, plan, status, price_lkr, start_date, expiry_date, created_at");
    if (error) throw new Error(error.message);
    const list = subs ?? [];

    const now = Date.now();
    let monthlyRevenue = 0;
    let activeCount = 0;
    let expiredCount = 0;
    const planDist: Record<string, { plan: string; count: number; revenue: number }> = {};

    for (const s of list) {
      if (s.status === "active") {
        activeCount += 1;
        monthlyRevenue += s.price_lkr ?? 0;
        const key = s.plan as string;
        planDist[key] = planDist[key] ?? {
          plan: PLAN_LABEL[key] ?? key,
          count: 0,
          revenue: 0,
        };
        planDist[key].count += 1;
        planDist[key].revenue += s.price_lkr ?? 0;
      }
      if (s.status === "expired") expiredCount += 1;
    }
    const annualRevenue = monthlyRevenue * 12;

    // Revenue by Month: last 12 months — sum prices of subscriptions started in that month
    const months: { key: string; label: string; revenue: number; new: number }[] = [];
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    for (let i = 11; i >= 0; i--) {
      const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
      months.push({
        key: `${m.getFullYear()}-${m.getMonth()}`,
        label: m.toLocaleDateString(undefined, { month: "short", year: "2-digit" }),
        revenue: 0,
        new: 0,
      });
    }
    const monthIndex = new Map(months.map((m, i) => [m.key, i]));
    for (const s of list) {
      const ref = s.start_date ?? s.created_at;
      if (!ref) continue;
      const dt = new Date(ref);
      const k = `${dt.getFullYear()}-${dt.getMonth()}`;
      const idx = monthIndex.get(k);
      if (idx == null) continue;
      months[idx].revenue += s.price_lkr ?? 0;
      months[idx].new += 1;
    }

    // Renewals due in 30 days
    const in30 = now + 30 * 86400000;
    let renewalsDue = 0;
    for (const s of list) {
      if (s.status !== "active" || !s.expiry_date) continue;
      const exp = new Date(s.expiry_date).getTime();
      if (exp <= in30 && exp >= now) renewalsDue += 1;
    }

    return {
      stats: {
        monthly_revenue: monthlyRevenue,
        annual_revenue: annualRevenue,
        active_subscriptions: activeCount,
        expired_subscriptions: expiredCount,
        renewals_due: renewalsDue,
        total_subscriptions: list.length,
      },
      revenue_by_month: months,
      plan_distribution: Object.values(planDist),
    };
  });
