import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { CreditCard, Calendar, MessageSquare, Bot, Sparkles } from "lucide-react";

function fmtDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
function fmtLKR(cents: number) {
  return `LKR ${(cents / 100).toLocaleString()}`;
}

export function SubscriptionWidget() {
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["my-subscription", user?.id],
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

      // Messages used since subscription start
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

  if (isLoading || !data) return null;

  const { sub, msgUsed, botsUsed } = data;
  const now = Date.now();
  const exp = sub.expiry_date ? new Date(sub.expiry_date).getTime() : null;
  const daysLeft = exp ? Math.max(0, Math.ceil((exp - now) / 86400000)) : null;

  const msgsAllowed = sub.max_messages; // null = unlimited
  const botsAllowed = sub.max_bots;
  const msgPct = msgsAllowed ? Math.min(100, (msgUsed / msgsAllowed) * 100) : 0;
  const botPct = botsAllowed ? Math.min(100, (botsUsed / botsAllowed) * 100) : 0;

  const statusVariant =
    sub.status === "active" ? "default" :
    sub.status === "expired" ? "destructive" : "secondary";

  const planLabel = sub.plan.charAt(0).toUpperCase() + sub.plan.slice(1);

  return (
    <Card className="relative overflow-hidden border-border/50 bg-card/60 backdrop-blur-sm">
      <div className="absolute inset-0 opacity-[0.08] bg-gradient-to-br from-primary via-fuchsia-500 to-cyan-500" />
      <div className="absolute -top-12 -right-12 h-40 w-40 rounded-full bg-primary/20 blur-3xl" />
      <CardContent className="relative p-6 space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-primary to-fuchsia-500 flex items-center justify-center shadow-lg shadow-primary/20">
              <Sparkles className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Current Plan</div>
              <div className="text-2xl font-bold flex items-center gap-2">
                {planLabel}
                <span className="text-sm font-medium text-muted-foreground">· {fmtLKR(sub.price_lkr)}/mo</span>
              </div>
            </div>
          </div>
          <Badge variant={statusVariant} className="capitalize">{sub.status}</Badge>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <MetaCell icon={Calendar} label="Days remaining" value={daysLeft === null ? "—" : `${daysLeft} days`} />
          <MetaCell icon={CreditCard} label="Renewal date" value={fmtDate(sub.expiry_date)} />
          <MetaCell icon={Sparkles} label="Started" value={fmtDate(sub.start_date)} />
        </div>

        <div className="space-y-4">
          <UsageBar
            icon={MessageSquare}
            label="Messages used"
            used={msgUsed}
            allowed={msgsAllowed}
            pct={msgPct}
          />
          <UsageBar
            icon={Bot}
            label="Bots active"
            used={botsUsed}
            allowed={botsAllowed}
            pct={botPct}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function MetaCell({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/40 p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="text-base font-semibold mt-1">{value}</div>
    </div>
  );
}

function UsageBar({
  icon: Icon, label, used, allowed, pct,
}: { icon: any; label: string; used: number; allowed: number | null; pct: number }) {
  const unlimited = allowed === null;
  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1.5">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Icon className="h-4 w-4" />
          <span>{label}</span>
        </div>
        <div className="font-medium">
          {used.toLocaleString()} <span className="text-muted-foreground">/ {unlimited ? "Unlimited" : allowed?.toLocaleString()}</span>
        </div>
      </div>
      <Progress value={unlimited ? 5 : pct} className="h-2" />
    </div>
  );
}
