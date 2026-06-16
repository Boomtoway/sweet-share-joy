import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import {
  listSubscriptions,
  updateSubscription,
  deleteSubscription,
} from "@/lib/subscriptions/subscriptions.functions";
import { useRole } from "@/hooks/use-role";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { CreditCard, Users, AlertTriangle, DollarSign, Calendar, Pencil, Pause, Play, Trash2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/subscriptions")({
  head: () => ({ meta: [{ title: "Subscriptions — Admin" }] }),
  component: SubscriptionsPage,
});

function fmtDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString();
}
function fmtLKR(n: number) {
  return `LKR ${(n / 100).toLocaleString(undefined, { minimumFractionDigits: 0 })}`;
}

function SubscriptionsPage() {
  const { role, loading } = useRole();
  const navigate = useNavigate();
  useEffect(() => {
    if (!loading && role !== "admin") navigate({ to: "/dashboard", replace: true });
  }, [role, loading, navigate]);

  const list = useServerFn(listSubscriptions);
  const upd = useServerFn(updateSubscription);
  const del = useServerFn(deleteSubscription);
  const qc = useQueryClient();

  const q = useQuery({ queryKey: ["admin-subs"], queryFn: () => list(), enabled: role === "admin" });

  const updMut = useMutation({
    mutationFn: (data: any) => upd({ data }),
    onSuccess: () => { toast.success("Subscription updated"); qc.invalidateQueries({ queryKey: ["admin-subs"] }); setEditOpen(false); },
    onError: (e: any) => toast.error(e?.message ?? "Update failed"),
  });
  const delMut = useMutation({
    mutationFn: (data: any) => del({ data }),
    onSuccess: () => { toast.success("Subscription deleted"); qc.invalidateQueries({ queryKey: ["admin-subs"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Delete failed"),
  });

  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState({ plan: "starter", expiry_date: "", price_lkr: 0 });

  function openEdit(s: any) {
    setEditing(s);
    setForm({
      plan: s.plan,
      expiry_date: s.expiry_date ? s.expiry_date.slice(0, 10) : "",
      price_lkr: s.price_lkr ?? 0,
    });
    setEditOpen(true);
  }

  if (loading || role !== "admin") return null;

  const subs = (q.data as any)?.subscriptions ?? [];
  const stats = (q.data as any)?.stats ?? { active_clients: 0, expired_clients: 0, monthly_revenue: 0, renewals_due: 0 };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <CreditCard className="h-6 w-6" /> Subscriptions
        </h1>
        <p className="text-sm text-muted-foreground">Manage client plans, billing, and renewals</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Users} label="Active Clients" value={String(stats.active_clients)} />
        <StatCard icon={AlertTriangle} label="Expired Clients" value={String(stats.expired_clients)} />
        <StatCard icon={DollarSign} label="Monthly Revenue" value={fmtLKR(stats.monthly_revenue)} />
        <StatCard icon={Calendar} label="Renewals Due (30d)" value={String(stats.renewals_due)} />
      </div>

      <Card>
        <CardHeader><CardTitle>All subscriptions</CardTitle></CardHeader>
        <CardContent>
          {q.isLoading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : subs.length === 0 ? (
            <div className="text-sm text-muted-foreground">No subscriptions yet.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Start</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subs.map((s: any) => (
                  <TableRow key={s.id}>
                    <TableCell>{s.profile?.full_name ?? "—"}</TableCell>
                    <TableCell>{s.profile?.email ?? "—"}</TableCell>
                    <TableCell className="capitalize">{s.plan}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          s.status === "active" ? "default" :
                          s.status === "expired" ? "destructive" : "secondary"
                        }
                      >
                        {s.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{fmtDate(s.start_date)}</TableCell>
                    <TableCell>{fmtDate(s.expiry_date)}</TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button size="sm" variant="outline" onClick={() => openEdit(s)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      {s.status === "active" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          title="Suspend"
                          onClick={() => updMut.mutate({ id: s.id, status: "cancelled" })}
                        >
                          <Pause className="h-3.5 w-3.5" />
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          title="Activate"
                          onClick={() => updMut.mutate({ id: s.id, status: "active" })}
                        >
                          <Play className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          if (!window.confirm(`Delete subscription for ${s.profile?.email ?? "client"}?`)) return;
                          delMut.mutate({ id: s.id });
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit subscription</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Plan</Label>
              <Select value={form.plan} onValueChange={(v) => setForm({ ...form, plan: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="starter">Starter — LKR 9,900 (1 bot / 500 msgs)</SelectItem>
                  <SelectItem value="growth">Growth — LKR 19,900 (3 bots / 3,000 msgs)</SelectItem>
                  <SelectItem value="agency">Agency — LKR 49,900 (unlimited)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Expiry date</Label>
              <Input
                type="date"
                value={form.expiry_date}
                onChange={(e) => setForm({ ...form, expiry_date: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Price (LKR cents) — leave 0 to apply plan default</Label>
              <Input
                type="number"
                value={form.price_lkr}
                onChange={(e) => setForm({ ...form, price_lkr: Number(e.target.value) })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                if (!editing) return;
                const payload: any = { id: editing.id, plan: form.plan };
                if (form.expiry_date) payload.expiry_date = new Date(form.expiry_date).toISOString();
                if (form.price_lkr > 0) payload.price_lkr = form.price_lkr;
                updMut.mutate(payload);
              }}
              disabled={updMut.isPending}
            >
              {updMut.isPending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className="rounded-md bg-primary/10 text-primary p-2"><Icon className="h-5 w-5" /></div>
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-xl font-semibold">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}
