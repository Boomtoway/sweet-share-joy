import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  disconnectVpsSession,
  getBotLogs,
  getVpsConfig,
  getVpsQr,
  getVpsStatus,
  restartVpsSession,
  rotateWebhookSecret,
  saveVpsConfig,
  testVpsConnection,
} from "@/lib/vps/bot.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Plug, QrCode, RefreshCw, Server, ShieldAlert, X } from "lucide-react";

export const Route = createFileRoute("/_authenticated/vps")({
  component: VpsPage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">{error.message}</div>,
  notFoundComponent: () => <div className="p-6">Not found</div>,
});

function VpsPage() {
  const router = useRouter();
  const fetchCfg = useServerFn(getVpsConfig);
  const save = useServerFn(saveVpsConfig);
  const logs = useServerFn(getBotLogs);
  const rotate = useServerFn(rotateWebhookSecret);

  const { data: cfg } = useQuery({ queryKey: ["vps-cfg"], queryFn: () => fetchCfg() });
  const { data: botLogs, refetch: refetchLogs } = useQuery({
    queryKey: ["bot-logs"],
    queryFn: () => logs(),
    refetchInterval: 5000,
  });

  const [form, setForm] = useState<any>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [qrData, setQrData] = useState<string | null>(null);
  const [statusInfo, setStatusInfo] = useState<any>(null);

  useEffect(() => {
    if (cfg) setForm(cfg);
  }, [cfg]);

  // Direct browser → VPS calls using saved URL + token (no internal /api/bot/* route).
  const callVps = async (path: string, method: "GET" | "POST" = "GET") => {
    const base = (form?.vps_endpoint ?? "").replace(/\/$/, "");
    const token = form?.vps_api_token ?? "";
    if (!base) throw new Error("Set VPS API URL first");
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });
    const text = await res.text();
    let body: any = text;
    try { body = JSON.parse(text); } catch {}
    if (!res.ok) throw new Error(typeof body === "string" ? body : body?.error || `VPS ${res.status}`);
    return body;
  };

  const test = () => callVps("/api/bot/session-status");
  const status = () => callVps("/api/bot/session-status");
  const qr = () => callVps("/api/bot/qr");
  const restart = () => callVps("/api/bot/restart", "POST");
  const disconnect = () => callVps("/api/bot/disconnect", "POST");

  // Auto-poll status + QR while not connected
  useEffect(() => {
    if (!form?.vps_endpoint || !form?.vps_api_token) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const s: any = await status();
        if (cancelled) return;
        setStatusInfo(s);
        if (s?.status !== "connected") {
          const r: any = await qr();
          if (!cancelled) setQrData(typeof r === "string" ? r : r?.qr ?? null);
        } else {
          setQrData(null);
        }
      } catch {}
    };
    tick();
    const id = setInterval(tick, 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form?.vps_endpoint, form?.vps_api_token]);

  const run = async (label: string, fn: () => Promise<any>) => {
    setBusy(label);
    try {
      const r = await fn();
      toast.success(`${label} ok`);
      return r;
    } catch (e: any) {
      toast.error(`${label}: ${e.message}`);
      throw e;
    } finally {
      setBusy(null);
      refetchLogs();
    }
  };

  const handleSave = () =>
    run("Save", () =>
      save({
        data: {
          vps_endpoint: form.vps_endpoint ?? "",
          vps_api_token: form.vps_api_token ?? "",
          daily_limit: Number(form.daily_limit ?? 200),
          min_delay_seconds: Number(form.min_delay_seconds ?? 8),
          max_delay_seconds: Number(form.max_delay_seconds ?? 25),
          ai_enabled: !!form.ai_enabled,
          list_mode: form.list_mode ?? "off",
          facebook_lead_only: !!form.facebook_lead_only,
        },
      }).then(() => router.invalidate()),
    );

  const handleQr = async () => {
    const r = await run("Fetch QR", () => qr());
    setQrData(typeof r === "string" ? r : r?.qr ?? r?.data ?? null);
  };

  const handleStatus = async () => {
    const r = await run("Status", () => status());
    setStatusInfo(r);
  };

  if (!form?.id) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const webhookUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/public/bot/webhook/message`
      : "/api/public/bot/webhook/message";

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-primary/10 p-2">
          <Server className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">VPS Bot Connection</h1>
          <p className="text-sm text-muted-foreground">
            External Node.js + Baileys WhatsApp bot. Lovable connects via REST.
          </p>
        </div>
        <Badge
          variant={statusInfo?.status === "connected" ? "default" : "outline"}
          className="ml-auto capitalize"
        >
          {statusInfo?.status ?? "unknown"}
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Connection</CardTitle>
          <CardDescription>VPS REST endpoint + bearer token</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <Label>VPS API URL</Label>
            <Input
              placeholder="https://bot.your-vps.com"
              value={form.vps_endpoint ?? ""}
              onChange={(e) => setForm({ ...form, vps_endpoint: e.target.value })}
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Bot API Token</Label>
            <Input
              type="password"
              placeholder="bearer token"
              value={form.vps_api_token ?? ""}
              onChange={(e) => setForm({ ...form, vps_api_token: e.target.value })}
            />
          </div>
          <div className="md:col-span-2 flex flex-wrap gap-2">
            <Button onClick={handleSave} disabled={busy === "Save"}>
              {busy === "Save" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save
            </Button>
            <Button variant="secondary" onClick={() => run("Test", () => test())} disabled={!!busy}>
              <Plug className="mr-2 h-4 w-4" /> Test connection
            </Button>
            <Button variant="secondary" onClick={handleStatus} disabled={!!busy}>
              <RefreshCw className="mr-2 h-4 w-4" /> Status
            </Button>
            <Button variant="secondary" onClick={handleQr} disabled={!!busy}>
              <QrCode className="mr-2 h-4 w-4" /> Get QR
            </Button>
            <Button variant="outline" onClick={() => run("Restart", () => restart())} disabled={!!busy}>
              Restart session
            </Button>
            <Button variant="destructive" onClick={() => run("Disconnect", () => disconnect())} disabled={!!busy}>
              <X className="mr-2 h-4 w-4" /> Disconnect
            </Button>
          </div>
          {statusInfo && (
            <div className="md:col-span-2 rounded-md border bg-muted/30 p-3 text-xs">
              <Badge variant="outline" className="mb-2">Session</Badge>
              <pre className="overflow-auto">{JSON.stringify(statusInfo, null, 2)}</pre>
            </div>
          )}
          {qrData && (
            <div className="md:col-span-2 flex flex-col items-center gap-2 rounded-md border p-4">
              {qrData.startsWith("data:image") ? (
                <img src={qrData} alt="WhatsApp QR" className="h-64 w-64" />
              ) : (
                <pre className="max-w-full overflow-auto text-xs">{qrData}</pre>
              )}
              <p className="text-xs text-muted-foreground">Scan with WhatsApp → Linked devices</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-primary" /> Risk Control
          </CardTitle>
          <CardDescription>Reply-only, random delays, daily caps</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label>Daily message limit</Label>
            <Input
              type="number"
              value={form.daily_limit ?? 200}
              onChange={(e) => setForm({ ...form, daily_limit: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">Sent today: {form.messages_today ?? 0}</p>
          </div>
          <div className="space-y-2">
            <Label>Min delay (sec)</Label>
            <Input
              type="number"
              value={form.min_delay_seconds ?? 8}
              onChange={(e) => setForm({ ...form, min_delay_seconds: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Max delay (sec)</Label>
            <Input
              type="number"
              value={form.max_delay_seconds ?? 25}
              onChange={(e) => setForm({ ...form, max_delay_seconds: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>List mode</Label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.list_mode ?? "off"}
              onChange={(e) => setForm({ ...form, list_mode: e.target.value })}
            >
              <option value="off">Off</option>
              <option value="whitelist">Whitelist only</option>
              <option value="blacklist">Block blacklist</option>
            </select>
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label>AI globally on</Label>
              <p className="text-xs text-muted-foreground">Master switch</p>
            </div>
            <Switch
              checked={!!form.ai_enabled}
              onCheckedChange={(v) => setForm({ ...form, ai_enabled: v })}
            />
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label>Facebook lead only</Label>
              <p className="text-xs text-muted-foreground">Restrict to FB-sourced leads</p>
            </div>
            <Switch
              checked={!!form.facebook_lead_only}
              onCheckedChange={(v) => setForm({ ...form, facebook_lead_only: v })}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Webhook</CardTitle>
          <CardDescription>Configure your VPS bot to POST incoming messages here</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <Label className="text-xs">URL</Label>
            <Input readOnly value={webhookUrl} />
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            <div>
              <Label className="text-xs">workspace_id</Label>
              <Input readOnly value={form.workspace_id} />
            </div>
            <div>
              <Label className="text-xs">secret</Label>
              <div className="flex gap-2">
                <Input readOnly value={form.webhook_secret ?? ""} />
                <Button
                  variant="outline"
                  onClick={() =>
                    run("Rotate secret", () => rotate()).then((r) => setForm({ ...form, ...r }))
                  }
                >
                  Rotate
                </Button>
              </div>
            </div>
          </div>
          <pre className="overflow-auto rounded-md bg-muted p-3 text-xs">
{`POST ${webhookUrl}
Content-Type: application/json
{
  "workspace_id": "${form.workspace_id}",
  "secret": "${form.webhook_secret ?? ""}",
  "from": "+94...",
  "contact_name": "Optional",
  "body": "customer message"
}`}
          </pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Bot & Error Logs</CardTitle>
          <CardDescription>Last 100 events</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-h-96 space-y-1 overflow-auto rounded-md border bg-muted/20 p-3 font-mono text-xs">
            {(botLogs ?? []).map((l: any) => (
              <div key={l.id} className="flex gap-2">
                <span className="text-muted-foreground">{new Date(l.created_at).toLocaleTimeString()}</span>
                <Badge
                  variant={l.level === "error" ? "destructive" : l.level === "warn" ? "secondary" : "outline"}
                  className="h-5 px-1 text-[10px]"
                >
                  {l.level}
                </Badge>
                <span className="flex-1">{l.message}</span>
              </div>
            ))}
            {!botLogs?.length && <div className="text-muted-foreground">No logs yet</div>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
