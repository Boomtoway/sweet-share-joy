import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import {
  getMyBilling,
  requestRenewal,
  createPaymentRequest,
  getSlipSignedUrl,
} from "@/lib/billing/billing.functions";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  CreditCard,
  CalendarClock,
  Wallet,
  CheckCircle2,
  Upload,
  RefreshCcw,
  FileText,
  Download,
  Clock,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/billing")({
  component: BillingPage,
});

const PLAN_LABEL: Record<string, string> = {
  starter: "Starter",
  growth: "Growth",
  agency: "Agency",
};

function formatLKR(n?: number | null) {
  if (n == null) return "—";
  return `LKR ${n.toLocaleString()}`;
}
function formatDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { v: any; label: string }> = {
    paid: { v: "default", label: "Paid" },
    active: { v: "default", label: "Paid" },
    pending: { v: "secondary", label: "Pending Review" },
    approved: { v: "default", label: "Approved" },
    rejected: { v: "destructive", label: "Rejected" },
    unpaid: { v: "destructive", label: "Unpaid" },
    expired: { v: "destructive", label: "Expired" },
    suspended: { v: "destructive", label: "Suspended" },
  };
  const cfg = map[status] ?? { v: "secondary", label: status };
  return <Badge variant={cfg.v}>{cfg.label}</Badge>;
}

function BillingPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const fetchBilling = useServerFn(getMyBilling);
  const fnRenewal = useServerFn(requestRenewal);
  const fnSlip = useServerFn(createPaymentRequest);
  const fnSign = useServerFn(getSlipSignedUrl);

  const { data, isLoading } = useQuery({
    queryKey: ["billing", user?.id],
    queryFn: () => fetchBilling(),
    enabled: !!user,
  });

  const sub = data?.subscription;
  const slips = data?.slips ?? [];
  const paymentStatus = data?.paymentStatus ?? "unpaid";

  const now = Date.now();
  const expiry = sub?.expiry_date ? new Date(sub.expiry_date).getTime() : null;
  const daysLeft = expiry ? Math.ceil((expiry - now) / 86400000) : null;
  const dueAmount = sub && (sub.status !== "active" || (daysLeft != null && daysLeft <= 7))
    ? sub.price_lkr
    : 0;

  const renewMut = useMutation({
    mutationFn: (note: string) => fnRenewal({ data: { note } }),
    onSuccess: () => {
      toast.success("Renewal request sent to StartAppLK.");
      qc.invalidateQueries({ queryKey: ["billing"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to request renewal"),
  });

  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [amount, setAmount] = useState<string>("");
  const [note, setNote] = useState("");

  async function handleUpload(file: File) {
    if (!user) return;
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() || "bin";
      const path = `${user.id}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("payment-slips")
        .upload(path, file, { upsert: false, contentType: file.type });
      if (upErr) throw upErr;
      await fnSlip({
        data: {
          storage_path: path,
          amount: amount ? Number(amount) : undefined,
          note: note || undefined,
        },
      });
      toast.success("Payment slip uploaded. We'll verify shortly.");
      setAmount("");
      setNote("");
      if (fileRef.current) fileRef.current.value = "";
      qc.invalidateQueries({ queryKey: ["billing"] });
    } catch (e: any) {
      toast.error(e.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function viewSlip(path: string) {
    try {
      const { url } = await fnSign({ data: { path } });
      window.open(url, "_blank");
    } catch (e: any) {
      toast.error(e.message ?? "Could not open slip");
    }
  }

  if (isLoading) {
    return <div className="p-8 text-muted-foreground">Loading billing…</div>;
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Billing</h1>
        <p className="text-muted-foreground">
          Manage your subscription, renewals, and payment slips.
        </p>
      </div>

      {!sub ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            No active subscription found. Please contact StartAppLK.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm text-muted-foreground">Current Plan</CardTitle>
                <CreditCard className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{PLAN_LABEL[sub.plan] ?? sub.plan}</div>
                <div className="text-xs text-muted-foreground">
                  {formatLKR(sub.price_lkr)} / month
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm text-muted-foreground">Amount Due</CardTitle>
                <Wallet className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatLKR(dueAmount)}</div>
                <div className="text-xs text-muted-foreground">
                  {dueAmount ? "Due now" : "No payment due"}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm text-muted-foreground">Renewal Date</CardTitle>
                <CalendarClock className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatDate(sub.expiry_date)}</div>
                <div className="text-xs text-muted-foreground">
                  {daysLeft != null
                    ? daysLeft >= 0
                      ? `${daysLeft} day${daysLeft === 1 ? "" : "s"} remaining`
                      : `Expired ${Math.abs(daysLeft)}d ago`
                    : "—"}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm text-muted-foreground">Payment Status</CardTitle>
                <CheckCircle2 className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="mt-1">
                  <StatusBadge status={paymentStatus} />
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <RefreshCcw className="h-5 w-5 text-primary" />
                  Request Renewal
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Send a renewal request to StartAppLK. We'll reach out with payment details.
                </p>
                <Textarea
                  placeholder="Optional note (e.g. preferred plan, contact time)"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                />
                <Button
                  className="w-full"
                  disabled={renewMut.isPending}
                  onClick={() => renewMut.mutate(note)}
                >
                  {renewMut.isPending ? "Sending…" : "Request Renewal"}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Upload className="h-5 w-5 text-primary" />
                  Upload Payment Slip
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Input
                  type="number"
                  placeholder="Amount (LKR)"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
                <Input
                  ref={fileRef}
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleUpload(f);
                  }}
                  disabled={uploading}
                />
                <p className="text-xs text-muted-foreground">
                  Accepted: JPG, PNG, PDF. Stored securely.
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" /> Payment History
              </CardTitle>
            </CardHeader>
            <CardContent>
              {slips.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  No payment activity yet.
                </p>
              ) : (
                <div className="divide-y">
                  {slips.map((s: any) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between py-3 gap-3"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center">
                          {s.type === "renewal_request" ? (
                            <Clock className="h-4 w-4" />
                          ) : (
                            <FileText className="h-4 w-4" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">
                            {s.type === "renewal_request"
                              ? "Renewal request"
                              : `Payment slip${s.amount ? ` · ${formatLKR(s.amount)}` : ""}`}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {formatDate(s.created_at)}
                            {s.note ? ` · ${s.note}` : ""}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <StatusBadge status={s.status} />
                        {s.storage_path && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => viewSlip(s.storage_path)}
                          >
                            <Download className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
