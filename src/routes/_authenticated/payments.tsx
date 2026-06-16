import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  listPaymentRequests,
  approvePaymentRequest,
  rejectPaymentRequest,
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

const PLAN_LABEL: Record<string, string> = {
  starter: "Starter",
  growth: "Growth",
  agency: "Agency",
};

function fmtDate(d?: string | null) {
  return d ? new Date(d).toLocaleString() : "—";
}
function fmtLKR(n?: number | string | null) {
  if (n == null) return "—";
  const num = typeof n === "string" ? Number(n) : n;
  return `LKR ${num.toLocaleString()}`;
}

function StatusBadge({ status }: { status: string }) {
  const m: Record<string, any> = {
    pending: "secondary",
    approved: "default",
    rejected: "destructive",
  };
  return <Badge variant={m[status] ?? "secondary"} className="capitalize">{status}</Badge>;
}

function PaymentsPage() {
  const qc = useQueryClient();
  const fetchAll = useServerFn(listPaymentRequests);
  const fnApprove = useServerFn(approvePaymentRequest);
  const fnReject = useServerFn(rejectPaymentRequest);
  const fnUrl = useServerFn(getAdminSlipUrl);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-payment-requests"],
    queryFn: () => fetchAll(),
  });

  const [tab, setTab] = useState<"pending" | "approved" | "rejected" | "all">("pending");
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const approveMut = useMutation({
    mutationFn: (id: string) => fnApprove({ data: { id } }),
    onSuccess: () => {
      toast.success("Payment approved. Subscription extended by 30 days.");
      qc.invalidateQueries({ queryKey: ["admin-payment-requests"] });
      qc.invalidateQueries({ queryKey: ["revenue-analytics"] });
      qc.invalidateQueries({ queryKey: ["billing"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to approve"),
  });

  const rejectMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      fnReject({ data: { id, reason } }),
    onSuccess: () => {
      toast.success("Payment rejected. Client has been notified.");
      setRejectId(null);
      setReason("");
      qc.invalidateQueries({ queryKey: ["admin-payment-requests"] });
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

  const requests = data?.requests ?? [];
  const stats = data?.stats ?? {
    pending: 0,
    approved: 0,
    rejected: 0,
    total: 0,
    pending_amount: 0,
    approved_amount: 0,
  };
  const filtered = tab === "all" ? requests : requests.filter((r: any) => r.status === tab);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Payment Approvals</h1>
        <p className="text-muted-foreground">
          Review uploaded payment slips and approve or reject client payments.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Pending" value={stats.pending} sub={fmtLKR(stats.pending_amount)} icon={Clock} />
        <StatCard label="Approved" value={stats.approved} sub={fmtLKR(stats.approved_amount)} icon={CheckCircle2} />
        <StatCard label="Rejected" value={stats.rejected} icon={XCircle} />
        <StatCard label="Total" value={stats.total} icon={Wallet} />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
          <CardTitle>Payment Requests</CardTitle>
          <div className="flex gap-2">
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
              No {tab === "all" ? "" : tab} payment requests.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Client</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Bank</TableHead>
                    <TableHead>Slip</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r: any) => {
                    const planKey = r.subscription?.plan ?? r.profile?.plan;
                    return (
                      <TableRow key={r.id}>
                        <TableCell>
                          <div className="font-medium">
                            {r.profile?.business_name ||
                              r.profile?.full_name ||
                              "—"}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {r.profile?.email ?? r.client_id.slice(0, 8)}
                          </div>
                        </TableCell>
                        <TableCell>
                          {planKey ? (
                            <Badge variant="outline">
                              {PLAN_LABEL[planKey] ?? planKey}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="font-medium">{fmtLKR(r.amount)}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {r.reference_number}
                        </TableCell>
                        <TableCell>{r.bank_name}</TableCell>
                        <TableCell>
                          {r.slip_path ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => openSlip(r.slip_path)}
                            >
                              <FileText className="h-4 w-4 mr-1" /> View
                              <ExternalLink className="h-3 w-3 ml-1" />
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {fmtDate(r.created_at)}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={r.status} />
                        </TableCell>
                        <TableCell className="text-right space-x-1 whitespace-nowrap">
                          <Button
                            size="sm"
                            disabled={r.status !== "pending" || approveMut.isPending}
                            onClick={() => approveMut.mutate(r.id)}
                          >
                            <Check className="h-4 w-4 mr-1" /> Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={r.status !== "pending"}
                            onClick={() => {
                              setRejectId(r.id);
                              setReason("");
                            }}
                          >
                            <X className="h-4 w-4 mr-1" /> Reject
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!rejectId} onOpenChange={(o) => !o && setRejectId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject payment request</DialogTitle>
          </DialogHeader>
          <Textarea
            placeholder="Reason (sent to the client in their notification)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={500}
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
  sub,
  icon: Icon,
}: {
  label: string;
  value: number;
  sub?: string;
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
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}
