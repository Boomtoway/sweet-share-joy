import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { getGeminiStatus, testGeminiConnection } from "@/lib/ai/gemini.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Sparkles, CheckCircle2, XCircle, Loader2, Activity, Coins, Clock } from "lucide-react";

export const Route = createFileRoute("/_authenticated/api-settings")({
  head: () => ({ meta: [{ title: "API Settings — Gemini" }] }),
  component: ApiSettingsPage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">{error.message}</div>,
  notFoundComponent: () => <div className="p-6">Not found</div>,
});

function ApiSettingsPage() {
  const fetchStatus = useServerFn(getGeminiStatus);
  const runTest = useServerFn(testGeminiConnection);

  const { data: status, isLoading, refetch } = useQuery({
    queryKey: ["gemini-status"],
    queryFn: () => fetchStatus(),
  });

  const [prompt, setPrompt] = useState("Say hello in one short sentence.");
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; reply?: string; tokens?: number; latency_ms?: number; error?: string } | null>(null);

  const handleTest = async () => {
    setTesting(true);
    setResult(null);
    try {
      const r = await runTest({ data: { prompt } });
      setResult(r);
      if (r.ok) toast.success(`Gemini OK • ${r.tokens ?? 0} tokens • ${r.latency_ms}ms`);
      else toast.error(r.error ?? "Test failed");
      refetch();
    } catch (e: any) {
      toast.error(e.message ?? "Test failed");
    } finally {
      setTesting(false);
    }
  };

  const configured = !!status?.configured;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-primary/10 p-2">
          <Sparkles className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Gemini API Settings</h1>
          <p className="text-sm text-muted-foreground">
            Google Gemini is wired through the secure server-side AI gateway. The API key is never exposed to the browser.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle>Connection</CardTitle>
            <CardDescription>Default model: <code>google/gemini-2.5-flash</code></CardDescription>
          </div>
          {isLoading ? (
            <Badge variant="secondary"><Loader2 className="mr-1 h-3 w-3 animate-spin" />Checking</Badge>
          ) : configured ? (
            <Badge className="bg-green-500/15 text-green-600 hover:bg-green-500/20">
              <CheckCircle2 className="mr-1 h-3 w-3" />Connected
            </Badge>
          ) : (
            <Badge variant="destructive"><XCircle className="mr-1 h-3 w-3" />Not configured</Badge>
          )}
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Stat icon={Activity} label="Requests" value={String(status?.requests ?? 0)} />
            <Stat icon={Coins} label="Tokens used" value={(status?.totalTokens ?? 0).toLocaleString()} />
            <Stat
              icon={Clock}
              label="Last used"
              value={status?.lastUsedAt ? new Date(status.lastUsedAt).toLocaleString() : "—"}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            The API key is stored as a server secret (<code>LOVABLE_API_KEY</code>) and only accessed inside server functions. It is never sent to the frontend.
            To change global AI behaviour visit{" "}
            <Link to="/ai-settings" className="text-primary underline">AI Agent Settings</Link>.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Test Gemini API</CardTitle>
          <CardDescription>Send a sample prompt to verify the connection.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Prompt</Label>
            <Textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          </div>
          <Button onClick={handleTest} disabled={testing || !configured}>
            {testing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Test API
          </Button>
          {result && (
            <div className={`rounded-md border p-4 text-sm ${result.ok ? "bg-muted/40" : "border-destructive/40 bg-destructive/5"}`}>
              {result.ok ? (
                <>
                  <div className="font-medium">Response</div>
                  <p className="mt-1 whitespace-pre-wrap">{result.reply}</p>
                  <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
                    <span>{result.tokens ?? 0} tokens</span>
                    <span>{result.latency_ms} ms</span>
                  </div>
                </>
              ) : (
                <span className="text-destructive">{result.error}</span>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}
