import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Loader2, MessageCircle, Server } from "lucide-react";

export const Route = createFileRoute("/_authenticated/whatsapp")({
  head: () => ({ meta: [{ title: "WhatsApp — StartAppLK" }] }),
  component: WhatsAppPage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">{error.message}</div>,
  notFoundComponent: () => <div className="p-6">Not found</div>,
});

interface WhatsAppSession {
  id: string;
  status: "disconnected" | "connecting" | "connected" | "error";
  phone_number: string | null;
  device_name: string | null;
  ai_enabled: boolean;
  daily_limit: number;
  messages_today: number;
  min_delay_seconds: number;
  max_delay_seconds: number;
  workspace_id: string;
}

const defaults = {
  phone_number: "",
  device_name: "",
  ai_enabled: true,
  daily_limit: 200,
  min_delay_seconds: 8,
  max_delay_seconds: 25,
};

function WhatsAppPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [session, setSession] = useState<WhatsAppSession | null>(null);
  const [form, setForm] = useState(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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
      setWorkspaceId(profile.workspace_id);
      const { data } = await supabase
        .from("whatsapp_sessions")
        .select("id,status,phone_number,device_name,ai_enabled,daily_limit,messages_today,min_delay_seconds,max_delay_seconds,workspace_id")
        .eq("workspace_id", profile.workspace_id)
        .maybeSingle();
      if (data) {
        setSession(data as WhatsAppSession);
        setForm({
          phone_number: data.phone_number ?? "",
          device_name: data.device_name ?? "",
          ai_enabled: data.ai_enabled,
          daily_limit: data.daily_limit,
          min_delay_seconds: data.min_delay_seconds,
          max_delay_seconds: data.max_delay_seconds,
        });
      }
      setLoading(false);
    })();
  }, []);

  const save = async () => {
    if (!workspaceId) {
      toast.error("No workspace found");
      return;
    }
    setSaving(true);
    const payload = {
      workspace_id: workspaceId,
      phone_number: form.phone_number || null,
      device_name: form.device_name || null,
      ai_enabled: form.ai_enabled,
      daily_limit: Number(form.daily_limit),
      min_delay_seconds: Number(form.min_delay_seconds),
      max_delay_seconds: Number(form.max_delay_seconds),
    };
    const { data, error } = session
      ? await supabase.from("whatsapp_sessions").update(payload).eq("id", session.id).select().single()
      : await supabase.from("whatsapp_sessions").insert(payload).select().single();
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setSession(data as WhatsAppSession);
    toast.success("WhatsApp settings saved");
  };

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center gap-3">
        <div className="rounded-md bg-primary/10 p-2"><MessageCircle className="h-5 w-5 text-primary" /></div>
        <div>
          <h1 className="text-2xl font-semibold">WhatsApp</h1>
          <p className="text-sm text-muted-foreground">Configure WhatsApp automation and handoff behavior.</p>
        </div>
        <Badge variant={session?.status === "connected" ? "default" : "outline"} className="ml-auto">
          {session?.status ?? "disconnected"}
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Session settings</CardTitle>
          <CardDescription>Set daily limits and AI behavior for WhatsApp conversations.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Phone number</Label>
            <Input value={form.phone_number} onChange={(e) => setForm({ ...form, phone_number: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Device name</Label>
            <Input value={form.device_name} onChange={(e) => setForm({ ...form, device_name: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Daily limit</Label>
            <Input type="number" value={form.daily_limit} onChange={(e) => setForm({ ...form, daily_limit: Number(e.target.value) })} />
            <p className="text-xs text-muted-foreground">Sent today: {session?.messages_today ?? 0}</p>
          </div>
          <div className="space-y-2">
            <Label>Message delay window</Label>
            <div className="grid grid-cols-2 gap-2">
              <Input type="number" value={form.min_delay_seconds} onChange={(e) => setForm({ ...form, min_delay_seconds: Number(e.target.value) })} />
              <Input type="number" value={form.max_delay_seconds} onChange={(e) => setForm({ ...form, max_delay_seconds: Number(e.target.value) })} />
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-md border p-3 md:col-span-2">
            <Switch checked={form.ai_enabled} onCheckedChange={(checked) => setForm({ ...form, ai_enabled: checked })} />
            <div>
              <div className="text-sm font-medium">AI replies enabled</div>
              <div className="text-xs text-muted-foreground">Turn off when agents should respond manually.</div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 md:col-span-2">
            <Button onClick={save} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save settings</Button>
            <Button variant="secondary" asChild><Link to="/vps"><Server className="mr-2 h-4 w-4" />Open VPS Bots</Link></Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}