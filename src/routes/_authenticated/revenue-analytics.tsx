import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getRevenueAnalytics } from "@/lib/revenue/revenue.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import {
  DollarSign,
  TrendingUp,
  Users,
  AlertCircle,
  CalendarClock,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/revenue-analytics")({
  component: RevenueAnalyticsPage,
});

const PIE_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--chart-2, 173 58% 39%))",
  "hsl(var(--chart-3, 12 76% 61%))",
  "hsl(var(--chart-4, 280 65% 60%))",
];

function fmtLKR(n: number) {
  return `LKR ${(n || 0).toLocaleString()}`;
}
function fmtCompact(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${n}`;
}

function RevenueAnalyticsPage() {
  const fetchFn = useServerFn(getRevenueAnalytics);
  const { data, isLoading } = useQuery({
    queryKey: ["revenue-analytics"],
    queryFn: () => fetchFn(),
  });

  const stats = data?.stats;
  const months = data?.revenue_by_month ?? [];
  const plans = data?.plan_distribution ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Revenue Analytics</h1>
          <p className="text-muted-foreground">
            Subscription revenue, growth, and plan distribution.
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Monthly Revenue"
          value={stats ? fmtLKR(stats.monthly_revenue) : "—"}
          sub={stats ? `${stats.active_subscriptions} active subscriptions` : ""}
          icon={DollarSign}
          accent="from-primary/20 to-primary/0"
        />
        <KpiCard
          label="Annual Revenue"
          value={stats ? fmtLKR(stats.annual_revenue) : "—"}
          sub="Projected (MRR × 12)"
          icon={TrendingUp}
          accent="from-emerald-500/20 to-emerald-500/0"
        />
        <KpiCard
          label="Active Subscriptions"
          value={stats ? String(stats.active_subscriptions) : "—"}
          sub={stats ? `${stats.renewals_due} renewals due in 30d` : ""}
          icon={Users}
          accent="from-blue-500/20 to-blue-500/0"
        />
        <KpiCard
          label="Expired Subscriptions"
          value={stats ? String(stats.expired_subscriptions) : "—"}
          sub={stats ? `${stats.total_subscriptions} lifetime` : ""}
          icon={AlertCircle}
          accent="from-rose-500/20 to-rose-500/0"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div>
              <CardTitle>Revenue by Month</CardTitle>
              <p className="text-sm text-muted-foreground">
                Last 12 months · LKR
              </p>
            </div>
            <CalendarClock className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent className="h-[320px]">
            {isLoading ? (
              <SkeletonChart />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={months} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.45} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis
                    dataKey="label"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={fmtCompact}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      color: "hsl(var(--popover-foreground))",
                    }}
                    formatter={(v: any) => fmtLKR(Number(v))}
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    fill="url(#rev)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Plan Distribution</CardTitle>
            <p className="text-sm text-muted-foreground">Active subscriptions by plan</p>
          </CardHeader>
          <CardContent className="h-[320px]">
            {isLoading ? (
              <SkeletonChart />
            ) : plans.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                No active subscriptions yet.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={plans}
                    dataKey="count"
                    nameKey="plan"
                    innerRadius={55}
                    outerRadius={90}
                    paddingAngle={3}
                    stroke="hsl(var(--background))"
                  >
                    {plans.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      color: "hsl(var(--popover-foreground))",
                    }}
                    formatter={(v: any, _n: any, p: any) =>
                      [`${v} subs · ${fmtLKR(p.payload.revenue)}`, p.payload.plan]
                    }
                  />
                  <Legend
                    verticalAlign="bottom"
                    height={32}
                    iconType="circle"
                    formatter={(value) => (
                      <span className="text-xs text-muted-foreground">{value}</span>
                    )}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Plan Performance</CardTitle>
          <p className="text-sm text-muted-foreground">
            Active subscribers and monthly revenue per plan
          </p>
        </CardHeader>
        <CardContent>
          {plans.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No active subscriptions to display.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {plans.map((p, i) => (
                <div
                  key={p.plan}
                  className="rounded-lg border border-border p-4 bg-card/50"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}
                      />
                      <span className="font-medium">{p.plan}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{p.count} subs</span>
                  </div>
                  <div className="mt-3 text-2xl font-bold">{fmtLKR(p.revenue)}</div>
                  <div className="text-xs text-muted-foreground">Monthly recurring</div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: any;
  accent: string;
}) {
  return (
    <Card className="relative overflow-hidden">
      <div
        className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${accent}`}
      />
      <CardHeader className="pb-2 flex-row items-center justify-between space-y-0 relative">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
        <div className="h-8 w-8 rounded-md bg-background/60 backdrop-blur flex items-center justify-center border border-border">
          <Icon className="h-4 w-4 text-primary" />
        </div>
      </CardHeader>
      <CardContent className="relative">
        <div className="text-2xl font-bold tracking-tight">{value}</div>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function SkeletonChart() {
  return (
    <div className="h-full w-full animate-pulse rounded-md bg-muted/40" />
  );
}
