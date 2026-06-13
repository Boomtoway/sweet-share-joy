import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, ShieldAlert } from "lucide-react";

export const Route = createFileRoute("/_authenticated/risk")({
  head: () => ({ meta: [{ title: "Risk Control — StartAppLK" }] }),
  component: RiskPage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">{error.message}</div>,
  notFoundComponent: () => <div className="p-6">Not found</div>,
});

type Severity = "low" | "medium" | "high" | "critical";

interface RiskLog {
  id: string;
  category: string;
  severity: Severity;
  description: string | null;
  resolved: boolean;
  created_at: string;
}

function severityVariant(severity: Severity) {
  return severity === "critical" || severity === "high" ? "destructive" : severity === "medium" ? "default" : "secondary";
}

function RiskPage() {
  const [logs, setLogs] = useState<RiskLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"open" | "resolved" | "all">("open");

  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        setLoading(false);
        return;
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("workspace_id")
        .eq("id", auth.user.id)
        .maybeSingle();
      if (!profile?.workspace_id) {
        setLoading(false);
        return;
      }
      const { data, error } = await supabase
        .from("risk_logs")
        .select("id,category,severity,description,resolved,created_at")
        .eq("workspace_id", profile.workspace_id)
        .order("created_at", { ascending: false });
      setLoading(false);
      if (error) {
        toast.error(error.message);
        return;
      }
      setLogs((data ?? []) as RiskLog[]);
    })();
  }, []);

  const visible = useMemo(() => logs.filter((log) => {
    if (filter === "open") return !log.resolved;
    if (filter === "resolved") return log.resolved;
    return true;
  }), [logs, filter]);

  const resolve = async (id: string) => {
    const { error } = await supabase.from("risk_logs").update({ resolved: true }).eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setLogs((items) => items.map((item) => item.id === id ? { ...item, resolved: true } : item));
    toast.success("Risk alert resolved");
  };

  const openCount = logs.filter((log) => !log.resolved).length;
  const criticalCount = logs.filter((log) => !log.resolved && log.severity === "critical").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="rounded-md bg-destructive/10 p-2"><ShieldAlert className="h-5 w-5 text-destructive" /></div>
        <div>
          <h1 className="text-2xl font-semibold">Risk Control</h1>
          <p className="text-sm text-muted-foreground">Review risky conversations, policy alerts, and agent safety signals.</p>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Open alerts</div><div className="text-2xl font-semibold">{openCount}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Critical</div><div className="text-2xl font-semibold">{criticalCount}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Resolved</div><div className="text-2xl font-semibold">{logs.filter((log) => log.resolved).length}</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>Alerts</CardTitle>
          <Select value={filter} onValueChange={(value) => setFilter(value as typeof filter)}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : visible.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No risk alerts found.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="font-medium">{log.category}</TableCell>
                    <TableCell><Badge variant={severityVariant(log.severity)}>{log.severity}</Badge></TableCell>
                    <TableCell>{log.description ?? "—"}</TableCell>
                    <TableCell>{new Date(log.created_at).toLocaleString()}</TableCell>
                    <TableCell className="text-right">
                      {log.resolved ? <Badge variant="outline">Resolved</Badge> : <Button size="sm" variant="secondary" onClick={() => resolve(log.id)}>Resolve</Button>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}