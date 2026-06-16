import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  listPaymentSlips,
  approvePaymentSlip,
  rejectPaymentSlip,
  getAdminSlipUrl,
} from "@/lib/payments/payments.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Check, X, ExternalLink, Wallet, Clock, CheckCircle2, XCircle, FileText,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/payments")({
  component: PaymentsPage,
});

function fmtDate(d?: string | null) {
  return d ? new Date(d).toLocaleString() : "—";
}
function fmtLKR(n?: number | null) {
  return n == null ? "—" : `LKR ${n.toLocaleString()}`;
}

function StatusBadge({ status }: { status: string }) {
  const m: Record<string, any> = {
    pending: "secondary",
    approved: "default",
    rejected: "destructive",
  };
  return <Badge variant={m[status] ?? "secondary"}>{status}</Badge>;
}

function PaymentsPage() {
  const qc = useQueryClient();
  const fetchAll = useServerFn(listPaymentSlips);
  const fnApprove = useServerFn(approvePaymentSlip);
  const fnReject = useServerFn(rejectPaymentSlip);
  const fnUrl = useServerFn(getAdminSlipUrl);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-payment-slips"],
    queryFn: () => fetchAll(),
  });

  const [tab, setTab] = useState<"pending" | "approved" | "rejected" | "all">("pending");
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const approveMut = useMutation({
    mutationFn: (id: string) => fnApprove({ data: { id } }),
    onSuccess: () => {
      toast.success("Payment approved. Subscription extended 30 days.");
      qc.invalidateQueries({ queryKey: ["admin-payment-slips"] });
      qc.invalidateQueries({ queryKey: ["subscriptions"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to approve"),
  });

  const rejectMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      fnReject({ data: { id, reason } }),
    onSuccess: () => {
      toast.success("Payment rejected.");
      setRejectId(null);
      setReason("");
      qc.invalidateQueries({ queryKey: ["admin-payment-slips"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to reject"),
  });

  async function openSlip(path: string) {
    try {
      const { url } = await fnUrl({ data: { path } });
      window.open(url, "_blank");
    } catch (e: any) {
      toast.error(e.message ?? "Could not open slip");
    }
  }

  const slips = data?.slips ?? [];
  const stats = data?.stats ?? { pending: 0, approved: 0, rejected: 0, total: 0 };
  const filtered = tab === "all" ? slips : slips.filter((s: any) => s.status === tab);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Payment Approvals</h1>
        <p className="text-muted-foreground">
          Review payment slips and renewal requests from clients.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Pending" value={stats.pending} icon={Clock} />
        <StatCard label="Approved" value={stats.approved} icon={CheckCircle2} />
        <StatCard label="Rejected" value={stats.rejected} icon={XCircle} />
        <StatCard label="Total" value={stats.total} icon={Wallet} />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
          <CardTitle>Payment Slips</CardTitle>
          <div className="flex gap-1">
            {(["pending", "approved", "rejected", "all"] as const).map((t) => (
              <Button
                key={t}
                size="sm"
                variant={tab === t ? "default" : "outline"}
                onClick={() => setTab(t)}
                className="capitalize"
              >
                {t}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground py-6 text-center">Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="text-muted-foreground py-10 text-center">
              No {tab === "all" ? "" : tab} payment slips.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Client</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Slip</TableHead>
                    <TableHead>Submitted</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((s: any) => (
                    <TableRow key={s.id}>
                      <TableCell>
                        <div className="font-medium">
                          {s.profile?.business_name ||
                            s.profile?.full_name ||
                            "—"}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {s.profile?.email ?? s.client_id.slice(0, 8)}
                        </div>
                      </TableCell>
                      <TableCell className="capitalize">
                        {s.type === "renewal_request" ? "Renewal request" : "Slip"}
                      </TableCell>
                      <TableCell>{fmtLKR(s.amount)}</TableCell>
                      <TableCell>
                        {s.storage_path ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => openSlip(s.storage_path)}
                          >
                            <FileText className="h-4 w-4 mr-1" /> View
                            <ExternalLink className="h-3 w-3 ml-1" />
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">No file</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtDate(s.created_at)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={s.status} />
                      </TableCell>
                      <TableCell className="text-right space-x-1">
                        <Button
                          size="sm"
                          disabled={s.status !== "pending" || approveMut.isPending}
                          onClick={() => approveMut.mutate(s.id)}
                        >
                          <Check className="h-4 w-4 mr-1" /> Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={s.status !== "pending"}
                          onClick={() => {
                            setRejectId(s.id);
                            setReason("");
                          }}
                        >
                          <X className="h-4 w-4 mr-1" /> Reject
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!rejectId} onOpenChange={(o) => !o && setRejectId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject payment</DialogTitle>
          </DialogHeader>
          <Textarea
            placeholder="Reason (optional, sent to admin notifications)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={rejectMut.isPending}
              onClick={() =>
                rejectId && rejectMut.mutate({ id: rejectId, reason })
              }
            >
              Reject Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: any;
}) {
  return (
    <Card>
      <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm text-muted-foreground">{label}</CardTitle>
        <Icon className="h-4 w-4 text-primary" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}
