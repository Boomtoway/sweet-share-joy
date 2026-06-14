import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  generateSalesReply,
  getAiSettings,
  getRecentBotErrors,
  updateAiSettings,
} from "@/lib/ai/sales-agent.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Bot, Loader2, Sparkles } from "lucide-react";

export const Route = createFileRoute("/_authenticated/ai-settings")({
  component: AiSettingsPage,
  errorComponent: ({ error }) => (
    <div className="p-6 text-destructive">Failed to load AI settings: {error.message}</div>
  ),
  notFoundComponent: () => <div className="p-6">Not found</div>,
});

const FIELDS: Array<{ key: string; label: string; placeholder?: string; rows?: number }> = [
  { key: "personality", label: "Bot personality", rows: 2 },
  { key: "business_tone", label: "Business tone", rows: 2 },
  { key: "sales_script", label: "Sales script", rows: 4 },
  { key: "pricing_rules", label: "Pricing rules", rows: 4 },
  { key: "faq_answers", label: "FAQ answers", rows: 6 },
  { key: "objection_handling", label: "Objection handling", rows: 4 },
  { key: "followup_script", label: "Follow-up script", rows: 3 },
  { key: "closing_script", label: "Closing script", rows: 3 },
];

function AiSettingsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const fetchSettings = useServerFn(getAiSettings);
  const saveSettings = useServerFn(updateAiSettings);
  const reply = useServerFn(generateSalesReply);
  const fetchErrors = useServerFn(getRecentBotErrors);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["ai-settings"],
    queryFn: () => fetchSettings(),
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  const { data: errorsData, refetch: refetchErrors } = useQuery({
    queryKey: ["ai-recent-errors"],
    queryFn: () => fetchErrors(),
    refetchInterval: 10000,
  });

  const [form, setForm] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [testMsg, setTestMsg] = useState("Hi, how much for a website?");
  const [testResult, setTestResult] = useState<any>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (data) {
      console.info("[AI Settings] Loaded row", {
        workspace_id: data.__debug?.workspace_id ?? data.workspace_id,
        row_id: data.id,
        enabled: data.enabled,
        auto_reply: data.auto_reply,
        row: data,
      });
      setForm(data);
    }
  }, [data]);

  const update = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await saveSettings({
        data: {
          personality: form.personality,
          business_tone: form.business_tone,
          sales_script: form.sales_script,
          pricing_rules: form.pricing_rules,
          faq_answers: form.faq_answers,
          objection_handling: form.objection_handling,
          followup_script: form.followup_script,
          closing_script: form.closing_script,
          tone: form.tone,
          language: form.language,
          model: form.model,
          temperature: Number(form.temperature),
          enabled: form.enabled,
          auto_reply: form.auto_reply,
        },
      });
      console.info("[AI Settings] Saved row", {
        workspace_id: updated.workspace_id,
        row_id: updated.id,
        enabled: updated.enabled,
        auto_reply: updated.auto_reply,
        row: updated,
      });
      setForm((current) => ({ ...current, ...updated }));
      queryClient.setQueryData(["ai-settings"], updated);
      await queryClient.invalidateQueries({ queryKey: ["ai-settings"] });
      toast.success("AI settings saved");
      router.invalidate();
    } catch (e: any) {
      toast.error(e.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await reply({ data: { message: testMsg, history: [], channel: "web" } });
      setTestResult(r);
    } catch (e: any) {
      toast.error(e.message ?? "Test failed");
    } finally {
      setTesting(false);
    }
  };

  if (isLoading || !form.id) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const debugRow = data ?? form;
  const debugWorkspaceId = debugRow.__debug?.workspace_id ?? debugRow.workspace_id;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-primary/10 p-2">
          <Bot className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">AI Sales Agent Settings</h1>
          <p className="text-sm text-muted-foreground">
            Gemini-powered. Replies in English, Tamil, or Sinhala automatically.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Engine</CardTitle>
          <CardDescription>Core model & behavior{isFetching ? " · refreshing" : ""}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Model</Label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.model ?? ""}
              onChange={(e) => update("model", e.target.value)}
            >
              <option value="google/gemini-3-flash-preview">Gemini 3 Flash (fast)</option>
              <option value="google/gemini-2.5-flash">Gemini 2.5 Flash</option>
              <option value="google/gemini-2.5-pro">Gemini 2.5 Pro</option>
              <option value="google/gemini-3.1-pro-preview">Gemini 3.1 Pro</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label>Temperature ({form.temperature})</Label>
            <Input
              type="number"
              step="0.1"
              min="0"
              max="2"
              value={form.temperature ?? 0.7}
              onChange={(e) => update("temperature", parseFloat(e.target.value))}
            />
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label>AI enabled</Label>
              <p className="text-xs text-muted-foreground">Turn the agent on/off globally</p>
            </div>
            <Switch checked={!!form.enabled} onCheckedChange={(v) => update("enabled", v)} />
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label>Auto-reply</Label>
              <p className="text-xs text-muted-foreground">Send replies automatically</p>
            </div>
            <Switch checked={!!form.auto_reply} onCheckedChange={(v) => update("auto_reply", v)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Debug: loaded AI settings row</CardTitle>
          <CardDescription>
            SQL equivalent: select * from ai_settings where workspace_id='{debugWorkspaceId}';
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="grid gap-2 md:grid-cols-2">
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">workspace_id</div>
              <div className="break-all font-mono">{debugWorkspaceId}</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">ai_settings row id</div>
              <div className="break-all font-mono">{debugRow.id}</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">enabled</div>
              <div className="font-mono">{String(debugRow.enabled)}</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">auto_reply</div>
              <div className="font-mono">{String(debugRow.auto_reply)}</div>
            </div>
          </div>
          <pre className="max-h-80 overflow-auto rounded-md border bg-muted/40 p-3 text-xs">
            {JSON.stringify(debugRow, null, 2)}
          </pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Last AI errors</span>
            <Button size="sm" variant="outline" onClick={() => refetchErrors()}>
              Refresh
            </Button>
          </CardTitle>
          <CardDescription>
            Most recent warnings/errors from the WhatsApp AI pipeline (auto-refreshes every 10s)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!errorsData?.errors?.length ? (
            <p className="text-sm text-muted-foreground">No recent errors. 🎉</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {errorsData.errors.map((e: any, i: number) => (
                <li key={i} className="rounded-md border p-3">
                  <div className="flex items-center justify-between">
                    <span
                      className={
                        "rounded px-2 py-0.5 text-xs font-semibold " +
                        (e.level === "error"
                          ? "bg-destructive/10 text-destructive"
                          : "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400")
                      }
                    >
                      {e.level}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(e.created_at).toLocaleString()}
                    </span>
                  </div>
                  <div className="mt-1 font-medium">{e.message}</div>
                  {e.metadata && Object.keys(e.metadata).length > 0 && (
                    <pre className="mt-2 max-h-40 overflow-auto rounded bg-muted/40 p-2 text-xs">
                      {JSON.stringify(e.metadata, null, 2)}
                    </pre>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sales playbook</CardTitle>
          <CardDescription>Edit how the agent talks, sells, and closes</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {FIELDS.map((f) => (
            <div key={f.key} className="space-y-2">
              <Label>{f.label}</Label>
              <Textarea
                rows={f.rows ?? 3}
                value={form[f.key] ?? ""}
                onChange={(e) => update(f.key, e.target.value)}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button onClick={handleSave} disabled={saving}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save settings
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" /> Test the agent
          </CardTitle>
          <CardDescription>Try a sample customer message</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea rows={3} value={testMsg} onChange={(e) => setTestMsg(e.target.value)} />
          <Button onClick={handleTest} disabled={testing} variant="secondary">
            {testing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Send test
          </Button>
          {testResult && (
            <div className="space-y-3 rounded-md border bg-muted/40 p-4 text-sm">
              <div>
                <span className="font-semibold">Reply ({testResult.detected_language}):</span>
                <p className="mt-1 whitespace-pre-wrap">{testResult.reply}</p>
              </div>
              <div>
                <span className="font-semibold">Needs human:</span> {String(testResult.needs_human)}
              </div>
              <div>
                <span className="font-semibold">Lead:</span>
                <pre className="mt-1 overflow-auto text-xs">
                  {JSON.stringify(testResult.lead, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
