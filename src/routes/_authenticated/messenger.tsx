import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  connectFacebookPage,
  connectInstagramAccount,
  disconnectMetaTarget,
  getMetaStatus,
  saveMetaWebhookConfig,
  sendMetaMessage,
} from "@/lib/meta/meta.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Facebook, Instagram, Plug, Trash2, Send, Webhook } from "lucide-react";

export function MetaConnectPage({ kind }: { kind: "messenger" | "instagram" }) {
  const fetchStatus = useServerFn(getMetaStatus);
  const saveCfg = useServerFn(saveMetaWebhookConfig);
  const addPage = useServerFn(connectFacebookPage);
  const addIg = useServerFn(connectInstagramAccount);
  const disconnect = useServerFn(disconnectMetaTarget);
  const send = useServerFn(sendMetaMessage);
  const qc = useQueryClient();

  const { data } = useQuery({ queryKey: ["meta-status"], queryFn: () => fetchStatus() });

  const channel = kind === "messenger" ? data?.messenger : data?.instagram;
  const items = kind === "messenger" ? data?.pages ?? [] : data?.instagram_accounts ?? [];

  const [cfg, setCfg] = useState({ app_id: "", app_secret: "", verify_token: "" });
  const [form, setForm] = useState<any>({});
  const [recipient, setRecipient] = useState("");
  const [message, setMessage] = useState("");
  const [target, setTarget] = useState<string>("");

  useEffect(() => {
    if (channel) {
      const c = (channel.config ?? {}) as any;
      setCfg({ app_id: c.app_id ?? "", app_secret: c.app_secret ?? "", verify_token: c.verify_token ?? "" });
    }
  }, [channel?.id]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["meta-status"] });

  const isFb = kind === "messenger";
  const Icon = isFb ? Facebook : Instagram;
  const title = isFb ? "Facebook Messenger" : "Instagram DM";
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Icon className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="text-sm text-muted-foreground">
            Connect {isFb ? "Facebook Pages" : "Instagram Business Accounts"} and route incoming DMs to Gemini.
          </p>
        </div>
        <Badge variant={channel?.status === "connected" ? "default" : "outline"} className="ml-auto">
          {channel?.status ?? "disconnected"}
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Webhook className="h-4 w-4" /> Meta Webhook Settings
          </CardTitle>
          <CardDescription>
            Paste the callback URL & verify token into Meta App Dashboard → Webhooks.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label>Callback URL</Label>
            <Input readOnly value={`${baseUrl}${data?.webhook_url ?? ""}`} />
          </div>
          <div className="grid md:grid-cols-3 gap-3">
            <div className="grid gap-2">
              <Label>App ID</Label>
              <Input value={cfg.app_id} onChange={(e) => setCfg({ ...cfg, app_id: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label>App Secret</Label>
              <Input
                type="password"
                value={cfg.app_secret}
                onChange={(e) => setCfg({ ...cfg, app_secret: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label>Verify Token</Label>
              <Input
                value={cfg.verify_token}
                onChange={(e) => setCfg({ ...cfg, verify_token: e.target.value })}
              />
            </div>
          </div>
          <Button
            onClick={async () => {
              try {
                await saveCfg({ data: { type: kind, ...cfg } });
                toast.success("Webhook settings saved");
                refresh();
              } catch (e: any) {
                toast.error(e.message);
              }
            }}
          >
            Save webhook settings
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plug className="h-4 w-4" /> {isFb ? "Connect a Facebook Page" : "Connect an Instagram Account"}
          </CardTitle>
          <CardDescription>
            Paste a long-lived page access token. (Full Meta OAuth flow comes after app review.)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid md:grid-cols-3 gap-3">
            {isFb ? (
              <>
                <div className="grid gap-2">
                  <Label>Page ID</Label>
                  <Input value={form.page_id ?? ""} onChange={(e) => setForm({ ...form, page_id: e.target.value })} />
                </div>
                <div className="grid gap-2">
                  <Label>Page Name</Label>
                  <Input value={form.page_name ?? ""} onChange={(e) => setForm({ ...form, page_name: e.target.value })} />
                </div>
              </>
            ) : (
              <>
                <div className="grid gap-2">
                  <Label>IG User ID</Label>
                  <Input value={form.ig_user_id ?? ""} onChange={(e) => setForm({ ...form, ig_user_id: e.target.value })} />
                </div>
                <div className="grid gap-2">
                  <Label>Username</Label>
                  <Input value={form.username ?? ""} onChange={(e) => setForm({ ...form, username: e.target.value })} />
                </div>
              </>
            )}
            <div className="grid gap-2">
              <Label>Access Token</Label>
              <Input
                type="password"
                value={form.access_token ?? ""}
                onChange={(e) => setForm({ ...form, access_token: e.target.value })}
              />
            </div>
          </div>
          <Button
            onClick={async () => {
              try {
                if (isFb) await addPage({ data: form });
                else await addIg({ data: form });
                setForm({});
                toast.success("Connected");
                refresh();
              } catch (e: any) {
                toast.error(e.message);
              }
            }}
          >
            Connect
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{isFb ? "Connected Pages" : "Connected Instagram Accounts"}</CardTitle>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">None connected yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((it: any) => (
                <li key={it.id} className="flex items-center justify-between py-3">
                  <div>
                    <div className="font-medium">{isFb ? it.page_name : `@${it.username}`}</div>
                    <div className="text-xs text-muted-foreground">
                      {isFb ? `Page ID ${it.page_id}` : `IG ID ${it.ig_user_id}`} ·{" "}
                      {it.webhook_verified ? "webhook verified" : "pending verification"}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      await disconnect({ data: { kind: isFb ? "page" : "instagram", id: it.id } });
                      refresh();
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Send className="h-4 w-4" /> Send Test Message (Placeholder)
          </CardTitle>
          <CardDescription>Logs the send to bot_logs until Meta Graph API is wired.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid md:grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label>{isFb ? "Page" : "Account"}</Label>
              <select
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="">Select…</option>
                {items.map((it: any) => (
                  <option key={it.id} value={it.id}>
                    {isFb ? it.page_name : `@${it.username}`}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label>Recipient ID (PSID / IGSID)</Label>
              <Input value={recipient} onChange={(e) => setRecipient(e.target.value)} />
            </div>
          </div>
          <Textarea
            placeholder="Message body"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
          />
          <Button
            disabled={!target || !recipient || !message}
            onClick={async () => {
              try {
                await send({ data: { kind, target_id: target, recipient_id: recipient, message } });
                toast.success("Queued (placeholder)");
                setMessage("");
              } catch (e: any) {
                toast.error(e.message);
              }
            }}
          >
            Send
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/messenger")({
  component: () => <MetaConnectPage kind="messenger" />,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">{error.message}</div>,
  notFoundComponent: () => <div className="p-6">Not found</div>,
});
