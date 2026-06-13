import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Settings } from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Settings — StartAppLK" }] }),
  component: SettingsPage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">{error.message}</div>,
  notFoundComponent: () => <div className="p-6">Not found</div>,
});

function SettingsPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        setLoading(false);
        return;
      }
      setUserId(auth.user.id);
      setEmail(auth.user.email ?? "");
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name,workspace_id")
        .eq("id", auth.user.id)
        .maybeSingle();
      setFullName(profile?.full_name ?? "");
      setWorkspaceId(profile?.workspace_id ?? null);
      if (profile?.workspace_id) {
        const { data: workspace } = await supabase
          .from("workspaces")
          .select("name")
          .eq("id", profile.workspace_id)
          .maybeSingle();
        setWorkspaceName(workspace?.name ?? "");
      }
      setLoading(false);
    })();
  }, []);

  const save = async () => {
    if (!userId) return;
    setSaving(true);
    const profileResult = await supabase.from("profiles").update({ full_name: fullName || null }).eq("id", userId);
    const workspaceResult = workspaceId
      ? await supabase.from("workspaces").update({ name: workspaceName || "Workspace" }).eq("id", workspaceId)
      : { error: null };
    setSaving(false);
    const error = profileResult.error || workspaceResult.error;
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Settings saved");
  };

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <div className="rounded-md bg-primary/10 p-2"><Settings className="h-5 w-5 text-primary" /></div>
        <div>
          <h1 className="text-2xl font-semibold">Settings</h1>
          <p className="text-sm text-muted-foreground">Manage your account and workspace details.</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>Your profile information for agent assignment and collaboration.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Email</Label>
            <Input value={email} readOnly />
          </div>
          <div className="space-y-2">
            <Label>Full name</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Workspace</CardTitle>
          <CardDescription>The workspace name shown to your team.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Workspace name</Label>
            <Input value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} />
          </div>
          <Button onClick={save} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save settings</Button>
        </CardContent>
      </Card>
    </div>
  );
}