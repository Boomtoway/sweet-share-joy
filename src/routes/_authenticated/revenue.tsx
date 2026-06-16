import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Pencil, DollarSign, TrendingUp, Trophy } from "lucide-react";

export const Route = createFileRoute("/_authenticated/revenue")({
  component: RevenuePage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">{error.message}</div>,
  notFoundComponent: () => <div className="p-6">Not found</div>,
});

interface WonLead {
  id: string;
  name: string | null;
  phone: string | null;
  service_interest: string | null;
  deal_value: number | null;
  value: number | null;
  won_date: string | null;
  stage_changed_at: string | null;
}

function fmtCurrency(n: number) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "LKR", maximumFractionDigits: 0 }).format(n || 0);
}

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function RevenuePage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<WonLead[]>([]);
  const [edit, setEdit] = useState<WonLead | null>(null);
  const [editVal, setEditVal] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editService, setEditService] = useState("");

  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      const { data: p } = await supabase.from("profiles").select("workspace_id").eq("id", auth.user.id).single();
      if (p?.workspace_id) setWorkspaceId(p.workspace_id);
    })();
  }, []);

  const load = async (ws: string) => {
    setLoading(true);
    const { data, error } = await supabase
      .from("leads")
      .select("id,name,phone,service_interest,deal_value,value,won_date,stage_changed_at")
      .eq("workspace_id", ws).eq("stage", "won")
      .order("won_date", { ascending: false, nullsFirst: false });
    setLoading(false);
    if (error) toast.error(error.message);
    else setRows((data ?? []) as any);
  };
  useEffect(() => { if (workspaceId) load(workspaceId); }, [workspaceId]);

  const totals = useMemo(() => {
    const total = rows.reduce((s, r) => s + Number(r.deal_value ?? r.value ?? 0), 0);
    const avg = rows.length ? total / rows.length : 0;
    return { total, avg, count: rows.length };
  }, [rows]);

  const openEdit = (r: WonLead) => {
    setEdit(r);
    setEditVal(String(r.deal_value ?? r.value ?? ""));
    setEditDate(r.won_date ? r.won_date.slice(0, 10) : "");
    setEditService(r.service_interest ?? "");
  };

  const saveEdit = async () => {
    if (!edit) return;
    const patch: any = {
      deal_value: Number(editVal) || 0,
      value: Number(editVal) || 0,
      won_date: editDate ? new Date(editDate).toISOString() : null,
      service_interest: editService || null,
    };
    const { error } = await supabase.from("leads").update(patch).eq("id", edit.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Revenue updated");
    setEdit(null);
    if (workspaceId) load(workspaceId);
  };

  return (
    <div className="p-4 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Stat icon={<DollarSign className="h-4 w-4 text-emerald-600" />} label="Total revenue won" value={fmtCurrency(totals.total)} />
        <Stat icon={<Trophy className="h-4 w-4 text-amber-600" />} label="Deals won" value={String(totals.count)} />
        <Stat icon={<TrendingUp className="h-4 w-4 text-violet-600" />} label="Average deal" value={fmtCurrency(totals.avg)} />
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center p-10"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : rows.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">No won deals yet.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead className="text-right">Deal Value</TableHead>
                  <TableHead>Won Date</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.name || "—"}</TableCell>
                    <TableCell>{r.phone || "—"}</TableCell>
                    <TableCell>{r.service_interest || "—"}</TableCell>
                    <TableCell className="text-right text-emerald-700 font-medium">
                      {fmtCurrency(Number(r.deal_value ?? r.value ?? 0))}
                    </TableCell>
                    <TableCell>{fmtDate(r.won_date ?? r.stage_changed_at)}</TableCell>
                    <TableCell>
                      <Button size="icon" variant="ghost" onClick={() => openEdit(r)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit revenue</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Deal value (LKR)</Label>
              <Input type="number" min={0} value={editVal} onChange={(e) => setEditVal(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Won date</Label>
              <Input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Service</Label>
              <Input value={editService} onChange={(e) => setEditService(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button>
            <Button onClick={saveEdit}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon}{label}</div>
        <div className="text-2xl font-semibold mt-1">{value}</div>
      </CardContent>
    </Card>
  );
}
