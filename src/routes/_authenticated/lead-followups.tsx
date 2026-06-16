import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { listFollowups, sendFollowupNow, stopFollowups, getFollowupTestMode, setFollowupTestMode, runFollowupCheckNow } from "@/lib/followups/followups.functions";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Send, Loader2, StopCircle, FlaskConical, PlayCircle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/lead-followups")({
  component: FollowupsPage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">{error.message}</div>,
  notFoundComponent: () => <div className="p-6">Not found</div>,
});

type Row = {
  id: string;
  conversation_id: string | null;
  phone: string | null;
  followup_type: string;
  message: string;
  scheduled_at: string | null;
  sent_at: string | null;
  status: string;
  error: string | null;
  contact?: { name: string | null; phone: string | null } | null;
};

const TYPE_LABEL: Record<string, string> = { day_1: "Day 1", day_3: "Day 3", day_7: "Day 7" };

function statusVariant(s: string): "default" | "secondary" | "destructive" | "outline" {
  if (s === "sent") return "default";
  if (s === "failed") return "destructive";
  if (s === "cancelled") return "outline";
  return "secondary";
}

function fmt(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

function FollowupsPage() {
  const listFn = useServerFn(listFollowups);
  const sendFn = useServerFn(sendFollowupNow);
  const stopFn = useServerFn(stopFollowups);
  const getTestFn = useServerFn(getFollowupTestMode);
  const setTestFn = useServerFn(setFollowupTestMode);
  const runCheckFn = useServerFn(runFollowupCheckNow);

  const { data: testModeData } = useQuery<{ test_mode: boolean }>({
    queryKey: ["followup-test-mode"],
    queryFn: () => getTestFn(),
  });
  const testMode = !!testModeData?.test_mode;

  const toggleTest = useMutation({
    mutationFn: (v: boolean) => setTestFn({ data: { test_mode: v } }),
    onSuccess: (r: any) => {
      toast.success(`Test mode ${r?.test_mode ? "ON (2/5/10 min)" : "OFF (1/3/7 days)"}`);
      qc.invalidateQueries({ queryKey: ["followup-test-mode"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });
  const qc = useQueryClient();
  const [tab, setTab] = useState("all");

  const { data: rows = [], isLoading } = useQuery<Row[]>({
    queryKey: ["lead-followups"],
    queryFn: () => listFn(),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["lead-followups"] });

  const send = useMutation({
    mutationFn: (id: string) => sendFn({ data: { id } }),
    onSuccess: () => { toast.success("Follow-up sent"); invalidate(); },
    onError: (e: any) => toast.error(e?.message ?? "Send failed"),
  });

  const stop = useMutation({
    mutationFn: (id: string) => stopFn({ data: { id } }),
    onSuccess: (r: any) => { toast.success(`Cancelled ${r?.cancelled ?? 0}`); invalidate(); },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  const runCheck = useMutation({
    mutationFn: () => runCheckFn(),
    onSuccess: (r: any) => {
      toast.success(`Scanned ${r?.scanned ?? 0} • Created ${r?.created ?? 0} • Sent ${r?.sent ?? 0} • Skipped ${r?.skipped ?? 0}`);
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Check failed"),
  });

  const filtered = useMemo(() => ({
    all: rows,
    pending: rows.filter((r) => r.status === "pending"),
    sent: rows.filter((r) => r.status === "sent"),
    failed: rows.filter((r) => r.status === "failed"),
    cancelled: rows.filter((r) => r.status === "cancelled"),
  }), [rows]);

  const renderTable = (data: Row[]) => (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Follow-up Type</TableHead>
              <TableHead>Scheduled Time</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Sent Time</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  No follow-ups
                </TableCell>
              </TableRow>
            )}
            {data.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.contact?.name ?? "—"}</TableCell>
                <TableCell>{r.phone ?? r.contact?.phone ?? "—"}</TableCell>
                <TableCell>{TYPE_LABEL[r.followup_type] ?? r.followup_type}</TableCell>
                <TableCell>{fmt(r.scheduled_at)}</TableCell>
                <TableCell><Badge variant={statusVariant(r.status)}>{r.status}</Badge>{r.error && <div className="text-xs text-destructive mt-1">{r.error}</div>}</TableCell>
                <TableCell>{fmt(r.sent_at)}</TableCell>
                <TableCell className="text-right space-x-1">
                  {r.status === "pending" && (
                    <>
                      <Button size="sm" variant="secondary" disabled={send.isPending} onClick={() => send.mutate(r.id)}>
                        <Send className="h-3 w-3 mr-1" />Send Follow-up Now
                      </Button>
                      <Button size="sm" variant="ghost" disabled={stop.isPending} onClick={() => stop.mutate(r.id)}>
                        <StopCircle className="h-3 w-3 mr-1" />Stop Follow-ups
                      </Button>
                    </>
                  )}
                  {r.status === "failed" && (
                    <Button size="sm" variant="outline" disabled={send.isPending} onClick={() => send.mutate(r.id)}>
                      <Send className="h-3 w-3 mr-1" />Retry
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2"><Send className="h-6 w-6" />Lead Follow-ups</h1>
          <p className="text-sm text-muted-foreground">
            Automated WhatsApp follow-ups for inactive leads. Reminders are auto-cancelled when the customer replies.
          </p>
        </div>
        <div className={`flex items-center gap-2 rounded-md border px-3 py-2 ${testMode ? "border-amber-500 bg-amber-50 dark:bg-amber-950/30" : ""}`}>
          <FlaskConical className={`h-4 w-4 ${testMode ? "text-amber-600" : "text-muted-foreground"}`} />
          <Label htmlFor="test-mode" className="text-sm cursor-pointer">
            TEST MODE {testMode ? "(2 / 5 / 10 min)" : "(1 / 3 / 7 days)"}
          </Label>
          <Switch
            id="test-mode"
            checked={testMode}
            disabled={toggleTest.isPending}
            onCheckedChange={(v) => toggleTest.mutate(v)}
          />
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="all">All ({filtered.all.length})</TabsTrigger>
            <TabsTrigger value="pending">Pending ({filtered.pending.length})</TabsTrigger>
            <TabsTrigger value="sent">Sent ({filtered.sent.length})</TabsTrigger>
            <TabsTrigger value="failed">Failed ({filtered.failed.length})</TabsTrigger>
            <TabsTrigger value="cancelled">Cancelled ({filtered.cancelled.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="all">{renderTable(filtered.all)}</TabsContent>
          <TabsContent value="pending">{renderTable(filtered.pending)}</TabsContent>
          <TabsContent value="sent">{renderTable(filtered.sent)}</TabsContent>
          <TabsContent value="failed">{renderTable(filtered.failed)}</TabsContent>
          <TabsContent value="cancelled">{renderTable(filtered.cancelled)}</TabsContent>
        </Tabs>
      )}
    </div>
  );
}
