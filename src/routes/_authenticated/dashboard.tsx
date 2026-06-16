import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SubscriptionWidget } from "@/components/subscription-widget";

import {
  Users,
  MessageSquare,
  Bot,
  Radio,
  Calendar,
  UserCheck,
  ShieldAlert,
  Server,
  DollarSign,
} from "lucide-react";

function fmtLkr(n: number) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "LKR", maximumFractionDigits: 0 }).format(n || 0);
}

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — StartAppLK" }] }),
  component: Dashboard,
});

function StatCard({
  title,
  value,
  icon: Icon,
  hint,
  gradient,
}: {
  title: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  hint?: string;
  gradient: string;
}) {
  return (
    <Card className="relative overflow-hidden backdrop-blur-sm bg-card/60 border-border/50 transition-all hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5">
      <div className={`absolute inset-0 opacity-10 bg-gradient-to-br ${gradient}`} />
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 relative">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <div className={`h-8 w-8 rounded-md bg-gradient-to-br ${gradient} flex items-center justify-center`}>
          <Icon className="h-4 w-4 text-white" />
        </div>
      </CardHeader>
      <CardContent className="relative">
        <div className="text-3xl font-bold">{value}</div>
        {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function Dashboard() {
  const { data: stats } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayIso = today.toISOString();

      const [
        leads,
        newMsgs,
        aiReplies,
        channels,
        appts,
        takeover,
        risks,
        bots,
      ] = await Promise.all([
        supabase.from("leads").select("*", { count: "exact", head: true }),
        supabase.from("messages").select("*", { count: "exact", head: true }).eq("direction", "inbound").gte("created_at", todayIso),
        supabase.from("messages").select("*", { count: "exact", head: true }).eq("sender", "ai").gte("created_at", todayIso),
        supabase.from("channels").select("*", { count: "exact", head: true }).eq("status", "connected"),
        supabase.from("appointments").select("*", { count: "exact", head: true }),
        supabase.from("conversations").select("*", { count: "exact", head: true }).eq("status", "human"),
        supabase.from("risk_logs").select("*", { count: "exact", head: true }).eq("resolved", false),
        supabase.from("whatsapp_sessions").select("*", { count: "exact", head: true }).eq("status", "connected"),
      ]);

      const { data: invs } = await (supabase as any).from("invoices").select("amount,paid_amount,balance_amount,status");
      let invoiced = 0, paidRev = 0, pendingRev = 0, overdueRev = 0;
      for (const r of (invs ?? []) as any[]) {
        invoiced += Number(r.amount ?? 0);
        paidRev += Number(r.paid_amount ?? 0);
        const bal = Number(r.balance_amount ?? 0);
        if (r.status === "overdue") overdueRev += bal;
        else if (r.status !== "paid") pendingRev += bal;
      }

      return {
        leads: leads.count ?? 0,
        newMsgs: newMsgs.count ?? 0,
        aiReplies: aiReplies.count ?? 0,
        channels: channels.count ?? 0,
        appts: appts.count ?? 0,
        takeover: takeover.count ?? 0,
        risks: risks.count ?? 0,
        bots: bots.count ?? 0,
        invoiced, paidRev, pendingRev, overdueRev,
      };
    },
  });

  const cards = [
    { title: "Total Leads", value: stats?.leads ?? "—", icon: Users, hint: "All time", gradient: "from-blue-500 to-cyan-500" },
    { title: "New Messages", value: stats?.newMsgs ?? "—", icon: MessageSquare, hint: "Today", gradient: "from-violet-500 to-purple-500" },
    { title: "AI Replies", value: stats?.aiReplies ?? "—", icon: Bot, hint: "Today", gradient: "from-emerald-500 to-teal-500" },
    { title: "Active Channels", value: stats?.channels ?? "—", icon: Radio, hint: "Connected", gradient: "from-amber-500 to-orange-500" },
    { title: "Appointments", value: stats?.appts ?? "—", icon: Calendar, hint: "Booked", gradient: "from-pink-500 to-rose-500" },
    { title: "Human Takeover", value: stats?.takeover ?? "—", icon: UserCheck, hint: "Awaiting agent", gradient: "from-indigo-500 to-blue-500" },
    { title: "Risk Alerts", value: stats?.risks ?? "—", icon: ShieldAlert, hint: "Unresolved", gradient: "from-red-500 to-rose-500" },
    { title: "Connected Bots", value: stats?.bots ?? "—", icon: Server, hint: "VPS sessions", gradient: "from-fuchsia-500 to-pink-500" },
    { title: "Total Invoiced", value: stats ? fmtLkr(stats.invoiced) : "—", icon: DollarSign, hint: "All invoices", gradient: "from-slate-500 to-zinc-500" },
    { title: "Paid Revenue", value: stats ? fmtLkr(stats.paidRev) : "—", icon: DollarSign, hint: "Received", gradient: "from-emerald-500 to-teal-500" },
    { title: "Pending Revenue", value: stats ? fmtLkr(stats.pendingRev) : "—", icon: DollarSign, hint: "Unpaid balance", gradient: "from-amber-500 to-orange-500" },
    { title: "Overdue Revenue", value: stats ? fmtLkr(stats.overdueRev) : "—", icon: DollarSign, hint: "Past due", gradient: "from-rose-500 to-red-500" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">Live overview of your AI sales operations.</p>
      </div>

      <SubscriptionWidget />

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">

        {cards.map((c) => (
          <StatCard key={c.title} {...c} />
        ))}
      </div>

      <Card className="backdrop-blur-sm bg-card/60 border-border/50">
        <CardHeader>
          <CardTitle>Getting started</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>1. Connect a channel — WhatsApp, Messenger, or Instagram.</p>
          <p>2. Configure your AI agent and add business knowledge.</p>
          <p>3. Define reply rules and risk controls.</p>
          <p>4. Watch conversations and leads flow in.</p>
        </CardContent>
      </Card>
    </div>
  );
}
