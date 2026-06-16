import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { listAppointments, updateAppointmentStatus } from "@/lib/appointments/appointments.functions";
import { sendReminderNow, listReminderLogs } from "@/lib/appointments/reminders.functions";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Calendar, CheckCircle2, XCircle, Clock, Loader2, Bell, History } from "lucide-react";

export const Route = createFileRoute("/_authenticated/appointments")({
  component: AppointmentsPage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">{error.message}</div>,
  notFoundComponent: () => <div className="p-6">Not found</div>,
});

type Appt = {
  id: string;
  name: string | null;
  phone: string | null;
  service_needed: string | null;
  appointment_date: string | null;
  appointment_time: string | null;
  appointment_datetime: string | null;
  status: string;
  notes: string | null;
  contact?: { name: string | null; phone: string | null } | null;
};

function statusVariant(s: string): "default" | "secondary" | "destructive" | "outline" {
  if (s === "completed") return "default";
  if (s === "cancelled" || s === "no_show") return "destructive";
  if (s === "confirmed") return "default";
  return "secondary";
}

function fmtDateTime(a: Appt): string {
  if (a.appointment_datetime) {
    const d = new Date(a.appointment_datetime);
    return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  }
  if (a.appointment_date) {
    return `${a.appointment_date}${a.appointment_time ? " " + a.appointment_time.slice(0, 5) : ""}`;
  }
  return "—";
}

function AppointmentsPage() {
  const listFn = useServerFn(listAppointments);
  const updateFn = useServerFn(updateAppointmentStatus);
  const qc = useQueryClient();
  const [tab, setTab] = useState("upcoming");

  const { data: appts = [], isLoading } = useQuery<Appt[]>({
    queryKey: ["appointments"],
    queryFn: () => listFn(),
  });

  const update = useMutation({
    mutationFn: (vars: { id: string; status: "scheduled" | "completed" | "cancelled" | "confirmed" | "no_show" }) =>
      updateFn({ data: vars }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["appointments"] });
      toast.success("Updated");
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  const sendNowFn = useServerFn(sendReminderNow);
  const sendNow = useMutation({
    mutationFn: (id: string) => sendNowFn({ data: { id, tier: "manual" } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["appointments"] });
      toast.success("Reminder sent");
    },
    onError: (e: any) => toast.error(e?.message ?? "Send failed"),
  });

  const [historyId, setHistoryId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const now = new Date();
    const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay); endOfDay.setDate(endOfDay.getDate() + 1);
    return {
      upcoming: appts.filter((a) => a.status === "scheduled" || a.status === "confirmed").filter((a) => {
        const dt = a.appointment_datetime ? new Date(a.appointment_datetime) : null;
        return !dt || dt >= now;
      }),
      today: appts.filter((a) => {
        const dt = a.appointment_datetime ? new Date(a.appointment_datetime) : null;
        return dt && dt >= startOfDay && dt < endOfDay;
      }),
      completed: appts.filter((a) => a.status === "completed"),
      cancelled: appts.filter((a) => a.status === "cancelled" || a.status === "no_show"),
    };
  }, [appts]);

  const renderReminderBadges = (a: Appt) => (
    <div className="flex gap-1 flex-wrap">
      <Badge variant={(a as any).reminder_24h_sent ? "default" : "outline"} className="text-xs">24h</Badge>
      <Badge variant={(a as any).reminder_1h_sent ? "default" : "outline"} className="text-xs">1h</Badge>
      <Badge variant={(a as any).reminder_15m_sent ? "default" : "outline"} className="text-xs">15m</Badge>
    </div>
  );

  const renderTable = (rows: Appt[]) => (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Service Needed</TableHead>
              <TableHead>Date & Time</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Reminders</TableHead>
              <TableHead>Notes</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                  No appointments
                </TableCell>
              </TableRow>
            )}
            {rows.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="font-medium">{a.name ?? a.contact?.name ?? "—"}</TableCell>
                <TableCell>{a.phone ?? a.contact?.phone ?? "—"}</TableCell>
                <TableCell>{a.service_needed ?? "—"}</TableCell>
                <TableCell>{fmtDateTime(a)}</TableCell>
                <TableCell><Badge variant={statusVariant(a.status)}>{a.status}</Badge></TableCell>
                <TableCell>{renderReminderBadges(a)}</TableCell>
                <TableCell className="max-w-xs truncate">{a.notes ?? "—"}</TableCell>
                <TableCell className="text-right space-x-1">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={sendNow.isPending}
                    onClick={() => sendNow.mutate(a.id)}
                  >
                    <Bell className="h-3 w-3 mr-1" />Send Reminder Now
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setHistoryId(a.id)}>
                    <History className="h-3 w-3 mr-1" />History
                  </Button>
                  {(a.status === "scheduled" || a.status === "confirmed") && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => update.mutate({ id: a.id, status: "completed" })}>
                        <CheckCircle2 className="h-3 w-3 mr-1" />Complete
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: a.id, status: "cancelled" })}>
                        <XCircle className="h-3 w-3 mr-1" />Cancel
                      </Button>
                    </>
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2"><Calendar className="h-6 w-6" />Appointments</h1>
          <p className="text-sm text-muted-foreground">Manage scheduled bookings from AI conversations and manual entries.</p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="upcoming">Upcoming ({filtered.upcoming.length})</TabsTrigger>
            <TabsTrigger value="today"><Clock className="h-3 w-3 mr-1" />Today ({filtered.today.length})</TabsTrigger>
            <TabsTrigger value="completed">Completed ({filtered.completed.length})</TabsTrigger>
            <TabsTrigger value="cancelled">Cancelled ({filtered.cancelled.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="upcoming">{renderTable(filtered.upcoming)}</TabsContent>
          <TabsContent value="today">{renderTable(filtered.today)}</TabsContent>
          <TabsContent value="completed">{renderTable(filtered.completed)}</TabsContent>
          <TabsContent value="cancelled">{renderTable(filtered.cancelled)}</TabsContent>
        </Tabs>
      )}
    </div>
  );
}
