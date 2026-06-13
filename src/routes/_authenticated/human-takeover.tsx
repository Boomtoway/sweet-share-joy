import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, UserCheck, Bot, Pause, Inbox } from "lucide-react";

export const Route = createFileRoute("/_authenticated/human-takeover")({
  component: HumanTakeoverPage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">{error.message}</div>,
  notFoundComponent: () => <div className="p-6">Not found</div>,
});

type Filter = "pending" | "assigned" | "resolved" | "high";

interface Conv {
  id: string;
  workspace_id: string;
  contact_id: string | null;
  status: string;
  unread_count: number;
  assigned_to: string | null;
  last_message_at: string | null;
  updated_at: string;
  created_at: string;
  contact: { id: string; name: string | null; phone: string | null; email: string | null; ai_enabled: boolean } | null;
  channel: { type: string; name: string } | null;
}

interface Member { id: string; full_name: string | null; }
interface Msg { id: string; body: string | null; sender: string; direction: string; created_at: string; }
interface Lead { id: string; stage: string; notes: string | null; score: number | null; }

function HumanTakeoverPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [convs, setConvs] = useState<Conv[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [filter, setFilter] = useState<Filter>("pending");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [lead, setLead] = useState<Lead | null>(null);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      setMe(auth.user.id);
      const { data: profile } = await supabase.from("profiles").select("workspace_id").eq("id", auth.user.id).single();
      if (profile?.workspace_id) setWorkspaceId(profile.workspace_id);
    })();
  }, []);

  const load = async (wsId: string) => {
    setLoading(true);
    const [{ data: cs, error }, { data: ms }] = await Promise.all([
      supabase.from("conversations")
        .select("*, contact:contacts(id,name,phone,email,ai_enabled), channel:channels(type,name)")
        .eq("workspace_id", wsId)
        .order("last_message_at", { ascending: false, nullsFirst: false }),
      supabase.from("profiles").select("id,full_name").eq("workspace_id", wsId),
    ]);
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    setConvs((cs ?? []) as any);
    setMembers((ms ?? []) as any);
  };

  useEffect(() => { if (workspaceId) load(workspaceId); }, [workspaceId]);

  const priority = (c: Conv) => (c.unread_count >= 5 ? "high" : c.unread_count > 0 ? "medium" : "low");

  const filtered = useMemo(() => convs.filter((c) => {
    if (filter === "pending") return c.status === "human" && !c.assigned_to;
    if (filter === "assigned") return c.status === "human" && !!c.assigned_to;
    if (filter === "resolved") return c.status === "closed";
    if (filter === "high") return priority(c) === "high";
    return true;
  }), [convs, filter]);

  const stats = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const waiting = convs.filter((c) => c.status === "human" && !c.assigned_to).length;
    const assigned = convs.filter((c) => c.status === "human" && !!c.assigned_to).length;
    const resolvedToday = convs.filter((c) => c.status === "closed" && new Date(c.updated_at) >= today).length;
    const humanConvs = convs.filter((c) => c.status === "human" || c.status === "closed");
    const avgMs = humanConvs.length
      ? humanConvs.reduce((s, c) => s + (new Date(c.updated_at).getTime() - new Date(c.created_at).getTime()), 0) / humanConvs.length
      : 0;
    const avgMin = Math.round(avgMs / 60000);
    return { waiting, assigned, resolvedToday, avgMin };
  }, [convs]);

  const openConv = async (id: string) => {
    setActiveId(id);
    const c = convs.find((x) => x.id === id);
    const [{ data: msgs }] = await Promise.all([
      supabase.from("messages").select("id,body,sender,direction,created_at")
        .eq("conversation_id", id).order("created_at", { ascending: false }).limit(8),
    ]);
    setMessages(((msgs ?? []) as any).reverse());
    if (c?.contact_id) {
      const { data: leadRow } = await supabase.from("leads")
        .select("id,stage,notes,score").eq("contact_id", c.contact_id).maybeSingle();
      setLead(leadRow as any);
      setNotes((leadRow as any)?.notes ?? "");
    } else { setLead(null); setNotes(""); }
  };

  const patchConv = async (id: string, patch: Partial<Conv>) => {
    const { data, error } = await supabase.from("conversations").update(patch as any).eq("id", id).select().single();
    if (error) { toast.error(error.message); return; }
    setConvs((cs) => cs.map((c) => (c.id === id ? { ...c, ...(data as any) } : c)));
  };

  const takeOver = (id: string) => patchConv(id, { status: "human", assigned_to: me } as any).then(() => toast.success("Taken over"));
  const release = async (id: string) => {
    const c = convs.find((x) => x.id === id);
    if (c?.contact_id) await supabase.from("contacts").update({ ai_enabled: true, human_takeover: false }).eq("id", c.contact_id);
    await patchConv(id, { status: "open", assigned_to: null } as any);
    toast.success("Released back to AI");
  };
  const pauseAi = async (id: string) => {
    const c = convs.find((x) => x.id === id);
    if (c?.contact_id) await supabase.from("contacts").update({ ai_enabled: false, human_takeover: true }).eq("id", c.contact_id);
    await patchConv(id, { status: "human" } as any);
    toast.success("AI paused");
  };
  const assign = (id: string, userId: string) =>
    patchConv(id, { assigned_to: userId, status: "human" } as any).then(() => toast.success("Assigned"));
  const resolve = (id: string) => patchConv(id, { status: "closed" } as any).then(() => toast.success("Resolved"));

  const saveNotes = async () => {
    const c = convs.find((x) => x.id === activeId);
    if (!c?.contact_id || !workspaceId) return;
    if (lead) {
      const { error } = await supabase.from("leads").update({ notes }).eq("id", lead.id);
      if (error) return toast.error(error.message);
    } else {
      const { data, error } = await supabase.from("leads").insert({
        workspace_id: workspaceId, contact_id: c.contact_id, stage: "new", notes,
      }).select().single();
      if (error) return toast.error(error.message);
      setLead(data as any);
    }
    toast.success("Notes saved");
  };

  const active = convs.find((c) => c.id === activeId) ?? null;
  const memberName = (uid: string | null) => members.find((m) => m.id === uid)?.full_name ?? (uid ? "Unknown" : "Unassigned");

  return (
    <div className="p-4 space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Waiting for human", value: stats.waiting },
          { label: "Assigned", value: stats.assigned },
          { label: "Resolved today", value: stats.resolvedToday },
          { label: "Avg response (min)", value: stats.avgMin },
        ].map((s) => (
          <Card key={s.label}><CardContent className="p-4">
            <div className="text-xs text-muted-foreground">{s.label}</div>
            <div className="text-2xl font-semibold">{s.value}</div>
          </CardContent></Card>
        ))}
      </div>

      <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
        <TabsList>
          <TabsTrigger value="pending">Pending</TabsTrigger>
          <TabsTrigger value="assigned">Assigned</TabsTrigger>
          <TabsTrigger value="resolved">Resolved</TabsTrigger>
          <TabsTrigger value="high">High Priority</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
        <Card>
          <CardHeader className="py-3"><CardTitle className="text-sm">Takeover queue</CardTitle></CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex justify-center p-8"><Loader2 className="h-4 w-4 animate-spin" /></div>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                <Inbox className="mx-auto mb-2 h-8 w-8 opacity-50" />
                No conversations currently require human takeover.
              </div>
            ) : (
              <ul className="divide-y">
                {filtered.map((c) => {
                  const p = priority(c);
                  return (
                    <li key={c.id} className={`p-3 cursor-pointer hover:bg-accent ${activeId === c.id ? "bg-accent" : ""}`}
                        onClick={() => openConv(c.id)}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-medium truncate">{c.contact?.name ?? c.contact?.phone ?? "Unknown"}</div>
                          <div className="text-xs text-muted-foreground flex flex-wrap gap-2">
                            <span>{c.channel?.type ?? "—"}</span>
                            <span>· Assigned: {memberName(c.assigned_to)}</span>
                            <span>· Status: {c.status}</span>
                          </div>
                        </div>
                        <Badge variant={p === "high" ? "destructive" : p === "medium" ? "default" : "secondary"}>{p}</Badge>
                      </div>
                      <div className="flex flex-wrap gap-2 mt-2" onClick={(e) => e.stopPropagation()}>
                        <Button size="sm" onClick={() => takeOver(c.id)}><UserCheck className="h-3 w-3 mr-1" />Take over</Button>
                        <Button size="sm" variant="outline" onClick={() => pauseAi(c.id)}><Pause className="h-3 w-3 mr-1" />Pause AI</Button>
                        <Button size="sm" variant="outline" onClick={() => release(c.id)}><Bot className="h-3 w-3 mr-1" />Release to AI</Button>
                        <Button size="sm" variant="ghost" onClick={() => resolve(c.id)}>Resolve</Button>
                        <Select value={c.assigned_to ?? ""} onValueChange={(v) => assign(c.id, v)}>
                          <SelectTrigger className="h-8 w-44 text-xs"><SelectValue placeholder="Assign to…" /></SelectTrigger>
                          <SelectContent>
                            {members.map((m) => <SelectItem key={m.id} value={m.id}>{m.full_name ?? m.id.slice(0, 8)}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-3"><CardTitle className="text-sm">Details</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            {!active ? (
              <p className="text-muted-foreground">Select a conversation to view details.</p>
            ) : (
              <>
                <div className="space-y-1">
                  <div><span className="text-muted-foreground">Name: </span>{active.contact?.name ?? "—"}</div>
                  <div><span className="text-muted-foreground">Phone: </span>{active.contact?.phone ?? "—"}</div>
                  <div><span className="text-muted-foreground">Email: </span>{active.contact?.email ?? "—"}</div>
                  <div><span className="text-muted-foreground">Channel: </span>{active.channel?.type ?? "—"}</div>
                  <div><span className="text-muted-foreground">Lead stage: </span>{lead?.stage ?? "—"}</div>
                  <div><span className="text-muted-foreground">Lead score: </span>{lead?.score ?? "—"}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Last messages</div>
                  <div className="space-y-1 max-h-48 overflow-auto">
                    {messages.length === 0 ? <div className="text-muted-foreground">No messages</div> :
                      messages.map((m) => (
                        <div key={m.id} className="text-xs border rounded p-2">
                          <div className="opacity-60">{m.sender} · {new Date(m.created_at).toLocaleString()}</div>
                          <div className="whitespace-pre-wrap">{m.body}</div>
                        </div>
                      ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Internal notes</Label>
                  <Textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
                  <Button size="sm" onClick={saveNotes}>Save notes</Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
