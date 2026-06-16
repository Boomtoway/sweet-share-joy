import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { sendInvoiceWhatsapp } from "@/lib/invoices/invoices.functions";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Loader2, MoreHorizontal, Send, CheckCircle2, Pencil, MessageCircle, DollarSign } from "lucide-react";

export const Route = createFileRoute("/_authenticated/invoices")({
  head: () => ({ meta: [{ title: "Invoices — StartAppLK" }] }),
  component: InvoicesPage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">{error.message}</div>,
  notFoundComponent: () => <div className="p-6">Not found</div>,
});

type Status = "draft" | "sent" | "partially_paid" | "paid" | "overdue";
interface Invoice {
  id: string;
  workspace_id: string;
  lead_id: string | null;
  customer_name: string | null;
  phone: string | null;
  service: string | null;
  invoice_number: string;
  amount: number;
  paid_amount: number;
  balance_amount: number;
  status: Status;
  due_date: string | null;
  notes: string | null;
  sent_at: string | null;
  paid_at: string | null;
  created_at: string;
}

const STATUS_LABEL: Record<Status, string> = {
  draft: "Draft", sent: "Sent", partially_paid: "Partially Paid", paid: "Paid", overdue: "Overdue",
};
const STATUS_COLOR: Record<Status, string> = {
  draft: "bg-slate-500", sent: "bg-blue-500", partially_paid: "bg-amber-500",
  paid: "bg-emerald-600", overdue: "bg-rose-600",
};

function fmtCurrency(n: number) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "LKR", maximumFractionDigits: 0 }).format(n || 0);
}
function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function InvoicesPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Invoice[]>([]);
  const [edit, setEdit] = useState<Invoice | null>(null);
  const [pay, setPay] = useState<Invoice | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const sendWa = useServerFn(sendInvoiceWhatsapp);

  useEffect(() => {
    (async () => {
      const { data: auth } = await (supabase as any).auth.getUser();
      if (!auth.user) return;
      const { data: p } = await (supabase as any).from("profiles").select("workspace_id").eq("id", auth.user.id).single();
      if (p?.workspace_id) setWorkspaceId(p.workspace_id);
    })();
  }, []);

  const load = async (ws: string) => {
    setLoading(true);
    const { data, error } = await supabase
      .from("invoices").select("*")
      .eq("workspace_id", ws)
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    setRows((data ?? []) as any);
  };
  useEffect(() => { if (workspaceId) load(workspaceId); }, [workspaceId]);

  const stats = useMemo(() => {
    let invoiced = 0, paid = 0, pending = 0, overdue = 0;
    for (const r of rows) {
      invoiced += Number(r.amount ?? 0);
      paid += Number(r.paid_amount ?? 0);
      const bal = Number(r.balance_amount ?? 0);
      if (r.status === "overdue") overdue += bal;
      else if (r.status !== "paid") pending += bal;
    }
    return { invoiced, paid, pending, overdue };
  }, [rows]);

  const updateInvoice = async (id: string, patch: Partial<Invoice>) => {
    const { error } = await (supabase as any).from("invoices").update(patch as any).eq("id", id);
    if (error) { toast.error(error.message); return false; }
    if (workspaceId) load(workspaceId);
    return true;
  };

  const markSent = async (inv: Invoice) => {
    const ok = await updateInvoice(inv.id, { status: "sent", sent_at: new Date().toISOString() } as any);
    if (ok) toast.success("Marked as sent");
  };
  const markPaid = async (inv: Invoice) => {
    const ok = await updateInvoice(inv.id, { paid_amount: Number(inv.amount), status: "paid", paid_at: new Date().toISOString() } as any);
    if (ok) toast.success("Marked as paid");
  };
  const recordPayment = async () => {
    if (!pay) return;
    const v = Number(payAmount);
    if (!v || v <= 0) { toast.error("Enter a valid amount"); return; }
    const newPaid = Number(pay.paid_amount || 0) + v;
    const ok = await updateInvoice(pay.id, { paid_amount: newPaid } as any);
    if (ok) { toast.success("Payment recorded"); setPay(null); setPayAmount(""); }
  };
  const sendWhatsapp = async (inv: Invoice) => {
    try {
      const r = await sendWa({ data: { invoice_id: inv.id } });
      if (r?.ok) toast.success("Invoice sent on WhatsApp");
      else toast.error("WhatsApp send failed");
      if (workspaceId) load(workspaceId);
    } catch (e: any) { toast.error(e?.message ?? "Send failed"); }
  };
  const saveEdit = async () => {
    if (!edit) return;
    const patch = {
      customer_name: edit.customer_name,
      phone: edit.phone,
      service: edit.service,
      amount: Number(edit.amount) || 0,
      due_date: edit.due_date,
      notes: edit.notes,
    };
    const ok = await updateInvoice(edit.id, patch as any);
    if (ok) { toast.success("Invoice updated"); setEdit(null); }
  };

  return (
    <div className="p-4 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Stat label="Total invoiced" value={fmtCurrency(stats.invoiced)} color="text-foreground" />
        <Stat label="Paid revenue" value={fmtCurrency(stats.paid)} color="text-emerald-600" />
        <Stat label="Pending revenue" value={fmtCurrency(stats.pending)} color="text-amber-600" />
        <Stat label="Overdue revenue" value={fmtCurrency(stats.overdue)} color="text-rose-600" />
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center p-10"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : rows.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              No invoices yet. Move a lead to <b>Won</b> in the CRM and click <b>Create Invoice</b>.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice No</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.invoice_number}</TableCell>
                    <TableCell className="font-medium">{r.customer_name || "—"}</TableCell>
                    <TableCell>{r.phone || "—"}</TableCell>
                    <TableCell>{r.service || "—"}</TableCell>
                    <TableCell className="text-right">{fmtCurrency(Number(r.amount))}</TableCell>
                    <TableCell className="text-right text-emerald-700">{fmtCurrency(Number(r.paid_amount))}</TableCell>
                    <TableCell className="text-right">{fmtCurrency(Number(r.balance_amount))}</TableCell>
                    <TableCell>
                      <Badge className={`${STATUS_COLOR[r.status]} text-white border-0`}>{STATUS_LABEL[r.status]}</Badge>
                    </TableCell>
                    <TableCell>{fmtDate(r.due_date)}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="ghost"><MoreHorizontal className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setEdit({ ...r })}>
                            <Pencil className="h-4 w-4 mr-2" />Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => markSent(r)}>
                            <Send className="h-4 w-4 mr-2" />Mark Sent
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => { setPay(r); setPayAmount(""); }}>
                            <DollarSign className="h-4 w-4 mr-2" />Record Payment
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => markPaid(r)}>
                            <CheckCircle2 className="h-4 w-4 mr-2" />Mark Paid
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => sendWhatsapp(r)}>
                            <MessageCircle className="h-4 w-4 mr-2" />Send WhatsApp Invoice
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
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
          <DialogHeader><DialogTitle>Edit invoice</DialogTitle></DialogHeader>
          {edit && (
            <div className="space-y-3">
              <Field label="Customer"><Input value={edit.customer_name ?? ""} onChange={(e) => setEdit({ ...edit, customer_name: e.target.value })} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Phone"><Input value={edit.phone ?? ""} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
                <Field label="Service"><Input value={edit.service ?? ""} onChange={(e) => setEdit({ ...edit, service: e.target.value })} /></Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Amount (LKR)"><Input type="number" value={edit.amount} onChange={(e) => setEdit({ ...edit, amount: Number(e.target.value) || 0 })} /></Field>
                <Field label="Due date"><Input type="date" value={edit.due_date ? edit.due_date.slice(0,10) : ""} onChange={(e) => setEdit({ ...edit, due_date: e.target.value || null })} /></Field>
              </div>
              <Field label="Notes"><Textarea rows={3} value={edit.notes ?? ""} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button>
            <Button onClick={saveEdit}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!pay} onOpenChange={(o) => !o && setPay(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record payment</DialogTitle></DialogHeader>
          {pay && (
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">
                Balance: <span className="font-medium text-foreground">{fmtCurrency(Number(pay.balance_amount))}</span>
              </div>
              <Field label="Amount received (LKR)">
                <Input type="number" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} autoFocus />
              </Field>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPay(null)}>Cancel</Button>
            <Button onClick={recordPayment}>Record</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (<div><Label className="text-xs">{label}</Label>{children}</div>);
}
function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <Card><CardContent className="p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${color}`}>{value}</div>
    </CardContent></Card>
  );
}
