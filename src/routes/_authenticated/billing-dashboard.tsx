import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  Sparkles,
  CreditCard,
  Calendar,
  MessageSquare,
  Bot,
  AlertTriangle,
  Ban,
  RefreshCcw,
  Upload,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";

function fmtDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
function fmtLKR(n?: number | null) {
  if (n == null) return "—";
  return `LKR ${n.toLocaleString()}`;
}

export const Route = createFileRoute("/_authenticated/billing-dashboard")({
  head: () => ({ meta: [{ title: "Billing Dashboard — StartAppLK" }] }),
  component: BillingDashboard,
});

function BillingDashboard() {
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["billing-dashboard", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data: sub } = await supabase
        .from("subscriptions")
        .select("*")
        .eq("client_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!sub) return null;

      const since = sub.start_date ?? new Date(Date.now() - 30 * 86400000).toISOString();
      const [{ count: msgCount }, { count: botCount }] = await Promise.all([
        supabase
          .from("messages")
          .select("*", { count: "exact", head: true })
          .eq("sender", "ai")
          .gte("created_at", since),
        supabase
          .from("whatsapp_sessions")
          .select("*", { count: "exact", head: true })
          .eq("status", "connected"),
      ]);

      return { sub, msgUsed: msgCount ?? 0, botsUsed: botCount ?? 0 };
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 bg-muted rounded animate-pulse" />
        <div className="grid gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}><CardContent className="h-28 bg-muted animate-pulse rounded-lg m-4" /></Card>
          ))}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Billing Dashboard</h1>
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground space-y-4">
            <p>No active subscription found.</p>
            <Button asChild>
              <Link to="/billing">Go to Billing</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { sub, msgUsed, botsUsed } = data;
  const now = Date.now();
  const exp = sub.expiry_date ? new Date(sub.expiry_date).getTime() : null;
  const daysLeft = exp ? Math.ceil((exp - now) / 86400000) : null;

  const msgsAllowed = sub.max_messages;
  const botsAllowed = sub.max_bots;
  const msgPct = msgsAllowed ? Math.min(100, (msgUsed / msgsAllowed) * 100) : 0;
  const botPct = botsAllowed ? Math.min(100, (botsUsed / botsAllowed) * 100) : 0;

  const isExpired = sub.status === "expired" || (daysLeft != null && daysLeft < 0);
  const isWarning = !isExpired && daysLeft != null && daysLeft <= 7;

  const planLabel = sub.plan.charAt(0).toUpperCase() + sub.plan.slice(1);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Billing Dashboard</h1>
        <p className="text-muted-foreground">Overview of your subscription, usage, and renewal status.</p>
      </div>

      {isExpired && (
        <Alert variant="destructive" className="border-red-500/30 bg-red-500/10">
          <Ban className="h-5 w-5 text-red-500" />
          <AlertTitle className="text-red-600 font-semibold">Subscription Expired</AlertTitle>
          <AlertDescription className="text-red-600/90">
            Your subscription has expired. Renew now to restore AI sales agent access.
            <div className="mt-3">
              <Button size="sm" variant="destructive" asChild>
                <Link to="/billing">Renew Subscription</Link>
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {!isExpired && isWarning && (
        <Alert className="border-amber-500/30 bg-amber-500/10">
          <AlertTriangle className="h-5 w-5 text-amber-600" />
          <AlertTitle className="text-amber-700 font-semibold">Renewal Due Soon</AlertTitle>
          <AlertDescription className="text-amber-700/90">
            Your subscription expires in {daysLeft} day{daysLeft === 1 ? "" : "s"}. Renew early to avoid interruption.
            <div className="mt-3">
              <Button size="sm" variant="outline" className="border-amber-600 text-amber-700 hover:bg-amber-500/10" asChild>
                <Link to="/billing">Renew Now</Link>
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Current Plan"
          value={planLabel}
          sub={fmtLKR(sub.price_lkr) + "/mo"}
          icon={Sparkles}
          gradient="from-primary to-fuchsia-500"
        />
        <StatCard
          title="Subscription Status"
          value={isExpired ? "Expired" : sub.status}
          sub={isExpired ? "Renewal required" : isWarning ? `${daysLeft} days left` : "Active"}
          icon={CheckCircle2}
          gradient={isExpired ? "from-red-500 to-rose-500" : "from-emerald-500 to-teal-500"}
        />
        <StatCard
          title="Days Remaining"
          value={daysLeft == null ? "—" : `${Math.max(0, daysLeft)}`}
          sub={daysLeft == null ? "No expiry set" : daysLeft < 0 ? `Expired ${Math.abs(daysLeft)}d ago` : "until renewal"}
          icon={Calendar}
          gradient="from-blue-500 to-cyan-500"
        />
        <StatCard
          title="Renewal Date"
          value={fmtDate(sub.expiry_date)}
          sub="Next billing cycle"
          icon={CreditCard}
          gradient="from-violet-500 to-purple-500"
        />
      </div>

      <Card className="relative overflow-hidden border-border/50 bg-card/60 backdrop-blur-sm">
        <div className="absolute inset-0 opacity-[0.06] bg-gradient-to-br from-primary via-fuchsia-500 to-cyan-500" />
        <CardHeader className="relative">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Subscription Details
          </CardTitle>
        </CardHeader>
        <CardContent className="relative space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <DetailRow label="Plan" value={planLabel} />
            <DetailRow label="Price" value={fmtLKR(sub.price_lkr)} />
            <DetailRow label="Started" value={fmtDate(sub.start_date)} />
            <DetailRow label="Max Bots" value={botsAllowed == null ? "Unlimited" : String(botsAllowed)} />
            <DetailRow label="Max Messages" value={msgsAllowed == null ? "Unlimited" : msgsAllowed.toLocaleString()} />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <UsageCard
          icon={MessageSquare}
          label="Messages"
          used={msgUsed}
          allowed={msgsAllowed}
          pct={msgPct}
          gradient="from-blue-500 to-cyan-500"
        />
        <UsageCard
          icon={Bot}
          label="Bots"
          used={botsUsed}
          allowed={botsAllowed}
          pct={botPct}
          gradient="from-fuchsia-500 to-pink-500"
        />
      </div>

      <Card className="border-border/50 bg-card/60 backdrop-blur-sm">
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold">Need to make changes?</h3>
              <p className="text-sm text-muted-foreground">Request a renewal or upload your payment slip.</p>
            </div>
            <div className="flex items-center gap-3">
              <Button variant="outline" asChild>
                <Link to="/billing">
                  <Upload className="h-4 w-4 mr-2" />
                  Upload Slip
                </Link>
              </Button>
              <Button asChild>
                <Link to="/billing">
                  <RefreshCcw className="h-4 w-4 mr-2" />
                  Request Renewal
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Link>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  title,
  value,
  sub,
  icon: Icon,
  gradient,
}: {
  title: string;
  value: string;
  sub: string;
  icon: React.ComponentType<{ className?: string }>;
  gradient: string;
}) {
  return (
    <Card className="relative overflow-hidden border-border/50 bg-card/60 backdrop-blur-sm transition-all hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5">
      <div className={`absolute inset-0 opacity-10 bg-gradient-to-br ${gradient}`} />
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 relative">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <div className={`h-8 w-8 rounded-md bg-gradient-to-br ${gradient} flex items-center justify-center`}>
          <Icon className="h-4 w-4 text-white" />
        </div>
      </CardHeader>
      <CardContent className="relative">
        <div className="text-2xl font-bold">{value}</div>
        <p className="text-xs text-muted-foreground mt-1 capitalize">{sub}</p>
      </CardContent>
    </Card>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/40 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold mt-1">{value}</div>
    </div>
  );
}

function UsageCard({
  icon: Icon,
  label,
  used,
  allowed,
  pct,
  gradient,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  used: number;
  allowed: number | null;
  pct: number;
  gradient: string;
}) {
  const unlimited = allowed === null;
  const overLimit = !unlimited && used > (allowed ?? 0);
  return (
    <Card className="relative overflow-hidden border-border/50 bg-card/60 backdrop-blur-sm">
      <div className={`absolute inset-0 opacity-[0.06] bg-gradient-to-br ${gradient}`} />
      <CardHeader className="relative flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Icon className="h-4 w-4" />
          {label} Usage
        </CardTitle>
        <Badge variant={overLimit ? "destructive" : "secondary"} className="relative">
          {unlimited ? "Unlimited" : `${used.toLocaleString()} / ${allowed?.toLocaleString()}`}
        </Badge>
      </CardHeader>
      <CardContent className="relative space-y-3">
        <div className="flex items-end justify-between">
          <div className="text-3xl font-bold">{unlimited ? used.toLocaleString() : `${Math.round(pct)}%`}</div>
          <div className="text-xs text-muted-foreground mb-1">
            {unlimited ? "No limit" : `${(allowed ?? 0) - used} remaining`}
          </div>
        </div>
        <div className="h-3 w-full rounded-full bg-primary/10 overflow-hidden">
          <div
            className={`h-full rounded-full bg-gradient-to-r ${gradient} transition-all duration-500`}
            style={{ width: `${unlimited ? 5 : pct}%` }}
          />
        </div>
        {overLimit && (
          <p className="text-xs text-red-500 font-medium">You have exceeded your {label.toLowerCase()} limit. Consider upgrading.</p>
        )}
      </CardContent>
    </Card>
  );
}
