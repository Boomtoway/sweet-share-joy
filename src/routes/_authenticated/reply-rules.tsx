import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, X, Plus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/reply-rules")({
  component: ReplyRulesPage,
  errorComponent: ({ error }) => (
    <div className="p-6 text-destructive">Error: {error.message}</div>
  ),
  notFoundComponent: () => <div className="p-6">Not found</div>,
});

type Settings = {
  enabled: boolean;
  auto_reply: boolean;
  business_hours_only: boolean;
  stop_on_human_reply: boolean;
  stop_on_human_request: boolean;
  stop_after_appointment: boolean;
  whitelist_numbers: string[];
  blacklist_numbers: string[];
  human_keywords: string[];
  daily_message_limit: number;
  min_reply_delay_seconds: number;
  max_reply_delay_seconds: number;
  spam_protection: boolean;
};

const FIELDS = [
  "enabled","auto_reply","business_hours_only","stop_on_human_reply",
  "stop_on_human_request","stop_after_appointment","whitelist_numbers",
  "blacklist_numbers","human_keywords","daily_message_limit",
  "min_reply_delay_seconds","max_reply_delay_seconds","spam_protection",
] as const;

function ReplyRulesPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [s, setS] = useState<Settings | null>(null);

  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      const { data: profile } = await supabase
        .from("profiles").select("workspace_id").eq("id", auth.user.id).single();
      if (!profile?.workspace_id) return;
      setWorkspaceId(profile.workspace_id);
      const { data, error } = await supabase
        .from("ai_settings").select(FIELDS.join(",")).eq("workspace_id", profile.workspace_id).single();
      if (error) { toast.error(error.message); setLoading(false); return; }
      setS(data as unknown as Settings);
      setLoading(false);
    })();
  }, []);

  const update = <K extends keyof Settings>(k: K, v: Settings[K]) =>
    setS((p) => (p ? { ...p, [k]: v } : p));

  async function save() {
    if (!s || !workspaceId) return;
    setSaving(true);
    const payload: Partial<Settings> = { ...s };
    if (payload.min_reply_delay_seconds! > payload.max_reply_delay_seconds!) {
      setSaving(false);
      toast.error("Min delay must be <= max delay");
      return;
    }
    const { error } = await supabase
      .from("ai_settings").update(payload).eq("workspace_id", workspaceId);
    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success("Reply rules saved");
  }

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (!s) return <div className="p-6">No AI settings found.</div>;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Reply Rules</h1>
        <p className="text-sm text-muted-foreground">Control how and when the AI replies to customers.</p>
      </div>

      <Card>
        <CardHeader><CardTitle>AI Reply Controls</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Toggle label="AI Enabled" v={s.enabled} on={(v) => update("enabled", v)} />
          <Toggle label="Auto Reply Enabled" v={s.auto_reply} on={(v) => update("auto_reply", v)} />
          <Toggle label="Business Hours Only" v={s.business_hours_only} on={(v) => update("business_hours_only", v)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Human Takeover Rules</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Toggle label="Stop AI when human replies manually" v={s.stop_on_human_reply} on={(v) => update("stop_on_human_reply", v)} />
          <Toggle label="Stop AI when customer requests human" v={s.stop_on_human_request} on={(v) => update("stop_on_human_request", v)} />
          <Toggle label="Stop AI after appointment booked" v={s.stop_after_appointment} on={(v) => update("stop_after_appointment", v)} />
        </CardContent>
      </Card>

      <ListEditor
        title="Whitelist Numbers"
        description="AI will only reply to these numbers (if any are set)."
        items={s.whitelist_numbers}
        onChange={(v) => update("whitelist_numbers", v)}
        placeholder="+94771234567"
      />

      <ListEditor
        title="Blacklist Numbers"
        description="AI will never reply to these numbers."
        items={s.blacklist_numbers}
        onChange={(v) => update("blacklist_numbers", v)}
        placeholder="+94771234567"
      />

      <ListEditor
        title="Human Trigger Keywords"
        description="If a customer's message contains any of these, AI hands off to a human."
        items={s.human_keywords}
        onChange={(v) => update("human_keywords", v)}
        placeholder="human"
      />

      <Card>
        <CardHeader><CardTitle>Safety Rules</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label>Daily message limit</Label>
            <Input type="number" min={0} value={s.daily_message_limit}
              onChange={(e) => update("daily_message_limit", Number(e.target.value))} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Min reply delay (seconds)</Label>
              <Input type="number" min={0} value={s.min_reply_delay_seconds}
                onChange={(e) => update("min_reply_delay_seconds", Number(e.target.value))} />
            </div>
            <div className="grid gap-2">
              <Label>Max reply delay (seconds)</Label>
              <Input type="number" min={0} value={s.max_reply_delay_seconds}
                onChange={(e) => update("max_reply_delay_seconds", Number(e.target.value))} />
            </div>
          </div>
          <Toggle label="Spam protection" v={s.spam_protection} on={(v) => update("spam_protection", v)} />
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save Rules
        </Button>
      </div>
    </div>
  );
}

function Toggle({ label, v, on }: { label: string; v: boolean; on: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between rounded-md border p-3">
      <Label className="cursor-pointer">{label}</Label>
      <Switch checked={v} onCheckedChange={on} />
    </div>
  );
}

function ListEditor({
  title, description, items, onChange, placeholder,
}: {
  title: string; description: string; items: string[];
  onChange: (v: string[]) => void; placeholder: string;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (!v || items.includes(v)) return;
    onChange([...items, v]);
    setDraft("");
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input value={draft} placeholder={placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
          <Button type="button" variant="secondary" onClick={add}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {items.length === 0 && <p className="text-sm text-muted-foreground">None added.</p>}
          {items.map((i) => (
            <Badge key={i} variant="secondary" className="gap-1">
              {i}
              <button onClick={() => onChange(items.filter((x) => x !== i))} className="ml-1">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
