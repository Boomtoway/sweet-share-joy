import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/debug")({
  component: DebugPage,
});

function Pretty({ value }: { value: unknown }) {
  return (
    <pre className="text-xs bg-muted p-3 rounded overflow-auto max-h-80">
      {value == null ? "—" : JSON.stringify(value, null, 2)}
    </pre>
  );
}

function StatusDot({ ok }: { ok: boolean | string }) {
  const good = ok === true;
  return (
    <Badge variant={good ? "default" : "destructive"}>
      {good ? "OK" : String(ok)}
    </Badge>
  );
}

function DebugPage() {
  const q = useQuery({
    queryKey: ["bot-debug"],
    queryFn: async () => {
      const res = await fetch("/api/public/bot/debug");
      return res.json();
    },
    refetchInterval: 5000,
  });

  const d = q.data ?? {};

  return (
    <div className="p-6 space-y-4 max-w-5xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Bot Debug</h1>
        <Button onClick={() => q.refetch()} disabled={q.isFetching}>
          {q.isFetching ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle>Health</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>Webhook: <StatusDot ok={d.webhook ?? false} /></div>
          <div>Gemini: <StatusDot ok={d.gemini ?? false} /></div>
          <div>Database: <StatusDot ok={d.database ?? false} /></div>
          <div>VPS: <StatusDot ok={d.vps ?? false} /></div>
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle>Last inbound webhook</CardTitle></CardHeader>
          <CardContent><Pretty value={d.last_webhook} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Last AI response</CardTitle></CardHeader>
          <CardContent><Pretty value={d.last_ai_response} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Last VPS /send response</CardTitle></CardHeader>
          <CardContent><Pretty value={d.last_vps_send} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Last VPS /send error</CardTitle></CardHeader>
          <CardContent><Pretty value={d.last_vps_error} /></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Recent outbound messages</CardTitle></CardHeader>
        <CardContent><Pretty value={d.recent_outbound} /></CardContent>
      </Card>
    </div>
  );
}
