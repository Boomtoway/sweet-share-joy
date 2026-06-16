import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/expire-subscriptions")({
  server: {
    handlers: {
      POST: handler,
      GET: handler, // allow manual trigger via browser for testing
    },
  },
});

async function handler() {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const nowIso = new Date().toISOString();

    // 1) Find active subs whose expiry has passed
    const { data: toExpire, error: findErr } = await supabaseAdmin
      .from("subscriptions")
      .select("id, client_id, plan, expiry_date")
      .eq("status", "active")
      .lt("expiry_date", nowIso);
    if (findErr) throw new Error(findErr.message);

    let expiredCount = 0;
    if (toExpire && toExpire.length > 0) {
      const ids = toExpire.map((s) => s.id);
      const { error: updErr } = await supabaseAdmin
        .from("subscriptions")
        .update({ status: "expired" })
        .in("id", ids);
      if (updErr) throw new Error(updErr.message);
      expiredCount = toExpire.length;

      // Enrich with client emails for the notification message
      const clientIds = Array.from(new Set(toExpire.map((s) => s.client_id)));
      const { data: profiles } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, email, business_name")
        .in("id", clientIds);
      const pMap = new Map((profiles ?? []).map((p) => [p.id, p]));

      // 2) Insert one admin notification per expired sub
      const notifications = toExpire.map((s) => {
        const p = pMap.get(s.client_id) as any;
        const who = p?.business_name || p?.full_name || p?.email || s.client_id;
        return {
          title: "Subscription expired",
          message: `${who} (${p?.email ?? "unknown"}) — ${s.plan} plan expired on ${new Date(s.expiry_date!).toLocaleDateString()}.`,
          type: "subscription_expired",
          metadata: { subscription_id: s.id, client_id: s.client_id, plan: s.plan },
        };
      });
      await supabaseAdmin.from("admin_notifications").insert(notifications);
    }

    // 3) Compute fresh dashboard stats and stash them as a single notification snapshot
    const { data: allSubs } = await supabaseAdmin
      .from("subscriptions")
      .select("status, price_lkr, expiry_date, client_id");
    const stats = (allSubs ?? []).reduce(
      (acc, s) => {
        if (s.status === "active") {
          acc.active_clients.add(s.client_id);
          acc.monthly_revenue += s.price_lkr ?? 0;
          if (s.expiry_date && new Date(s.expiry_date).getTime() <= Date.now() + 30 * 86400000) {
            acc.renewals_due += 1;
          }
        }
        if (s.status === "expired") acc.expired_clients.add(s.client_id);
        return acc;
      },
      { active_clients: new Set<string>(), expired_clients: new Set<string>(), monthly_revenue: 0, renewals_due: 0 }
    );

    const snapshot = {
      active_clients: stats.active_clients.size,
      expired_clients: stats.expired_clients.size,
      monthly_revenue: stats.monthly_revenue,
      renewals_due: stats.renewals_due,
      checked_at: nowIso,
      expired_today: expiredCount,
    };

    if (expiredCount > 0) {
      await supabaseAdmin.from("admin_notifications").insert({
        title: "Daily subscription check",
        message: `${expiredCount} subscription(s) marked expired. Active: ${snapshot.active_clients}, Expired: ${snapshot.expired_clients}, Renewals due (30d): ${snapshot.renewals_due}.`,
        type: "subscription_check_summary",
        metadata: snapshot,
      });
    }

    return Response.json({ ok: true, ...snapshot });
  } catch (e: any) {
    console.error("expire-subscriptions failed:", e);
    return new Response(JSON.stringify({ ok: false, error: e?.message ?? "unknown" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
