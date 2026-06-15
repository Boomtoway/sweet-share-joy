import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { sendManualWhatsAppMessage, testVpsSend } from "@/lib/vps/bot.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Inbox, Loader2, Send } from "lucide-react";

export const Route = createFileRoute("/_authenticated/conversations")({
  component: ConversationsPage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">{error.message}</div>,
  notFoundComponent: () => <div className="p-6">Not found</div>,
});

type ChannelType = "whatsapp" | "messenger" | "instagram";
type AiFilter = "all" | "ai" | "human";

interface Conv {
  id: string;
  workspace_id: string;
  contact_id: string | null;
  channel_id: string | null;
  status: string;
  remote_jid: string | null;
  last_message_at: string | null;
  unread_count: number;
  contact: {
    id: string;
    name: string | null;
    phone: string | null;
    remote_jid: string | null;
    email: string | null;
    ai_enabled: boolean;
    human_takeover: boolean;
  } | null;
  channel: { id: string; type: ChannelType; name: string } | null;
}

interface Msg {
  id: string;
  direction: "inbound" | "outbound";
  sender: string;
  body: string | null;
  created_at: string;
  delivery_status?: "pending" | "sent" | "delivered" | "failed" | null;
  delivery_error?: string | null;
  target_jid?: string | null;
}

type LeadStage = "new" | "contacted" | "qualified" | "proposal" | "won" | "lost";
interface Lead {
  id: string;
  stage: LeadStage;
  notes: string | null;
  value: number;
}

const STAGES: LeadStage[] = ["new", "contacted", "qualified", "proposal", "won", "lost"];

function ConversationsPage() {
  const sendManualMessage = useServerFn(sendManualWhatsAppMessage);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [convs, setConvs] = useState<Conv[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [lead, setLead] = useState<Lead | null>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);

  const [channelFilter, setChannelFilter] = useState<"all" | ChannelType>("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [aiFilter, setAiFilter] = useState<AiFilter>("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      const { data: profile } = await supabase.from("profiles").select("workspace_id").eq("id", auth.user.id).single();
      if (profile?.workspace_id) setWorkspaceId(profile.workspace_id);
    })();
  }, []);

  const loadConvs = async (wsId: string) => {
    setLoading(true);
    const { data, error } = await supabase
      .from("conversations")
      .select("*, contact:contacts(id,name,phone,remote_jid,email,ai_enabled,human_takeover), channel:channels(id,type,name)")
      .eq("workspace_id", wsId)
      .order("last_message_at", { ascending: false, nullsFirst: false });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    setConvs((data ?? []) as any);
  };

  useEffect(() => { if (workspaceId) loadConvs(workspaceId); }, [workspaceId]);

  const loadConversation = async (id: string) => {
    setActiveId(id);
    const [{ data: msgs }, conv] = await Promise.all([
      supabase.from("messages").select("*").eq("conversation_id", id).order("created_at", { ascending: true }),
      Promise.resolve(convs.find((c) => c.id === id)),
    ]);
    setMessages((msgs ?? []) as any);
    if (conv?.contact_id) {
      const { data: leadRow } = await supabase
        .from("leads").select("id,stage,notes,value")
        .eq("contact_id", conv.contact_id).maybeSingle();
      setLead(leadRow as any);
    } else setLead(null);
    if (conv && conv.unread_count > 0) {
      await supabase.from("conversations").update({ unread_count: 0 }).eq("id", id);
      setConvs((cs) => cs.map((c) => (c.id === id ? { ...c, unread_count: 0 } : c)));
    }
  };

  const filtered = useMemo(() => convs.filter((c) => {
    if (channelFilter !== "all" && c.channel?.type !== channelFilter) return false;
    if (unreadOnly && c.unread_count === 0) return false;
    if (aiFilter === "ai" && !c.contact?.ai_enabled) return false;
    if (aiFilter === "human" && c.contact?.ai_enabled) return false;
    if (search) {
      const q = search.toLowerCase();
      const name = (c.contact?.name ?? "").toLowerCase();
      const phone = (c.contact?.phone ?? "").toLowerCase();
      if (!name.includes(q) && !phone.includes(q)) return false;
    }
    return true;
  }), [convs, channelFilter, unreadOnly, aiFilter, search]);

  const active = convs.find((c) => c.id === activeId) ?? null;

  const sendReply = async () => {
    if (!active || !reply.trim() || !workspaceId) return;
    const messageText = reply.trim();
    // Always use the CURRENTLY selected contact's identity. Contact wins over conversation.remote_jid
    // because conversation.remote_jid can be stale from earlier imports.
    const panelRecipient = active.contact?.phone || active.contact?.remote_jid || active.remote_jid || "";
    console.log("PANEL_RECIPIENT", { conversation_id: active.id, panelRecipient, contact_phone: active.contact?.phone, contact_jid: active.contact?.remote_jid, conv_jid: active.remote_jid });
    if (!panelRecipient) { toast.error("Selected contact has no phone / remote_jid"); return; }
    setSending(true);
    try {
      const result = await sendManualMessage({ data: { conversationId: active.id, message: messageText, to: panelRecipient } });
      setMessages((m) => [...m, result.message as any]);
      setConvs((cs) => cs.map((c) => (c.id === active.id ? { ...c, last_message_at: new Date().toISOString() } : c)));
      setReply("");
      toast.success(`Message sent → ${(result as any).finalSendNumber ?? panelRecipient}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Message failed");
    } finally {
      setSending(false);
    }
  };

  const toggleAi = async (enabled: boolean) => {
    if (!active?.contact) return;
    const { error } = await supabase.from("contacts")
      .update({ ai_enabled: enabled, human_takeover: !enabled })
      .eq("id", active.contact.id);
    if (error) { toast.error(error.message); return; }
    setConvs((cs) => cs.map((c) => c.id === active.id && c.contact
      ? { ...c, contact: { ...c.contact, ai_enabled: enabled, human_takeover: !enabled } } : c));
  };

  const updateLead = async (patch: Partial<Lead>) => {
    if (!active?.contact_id || !workspaceId) return;
    if (lead) {
      const { data, error } = await supabase.from("leads").update(patch).eq("id", lead.id).select().single();
      if (error) { toast.error(error.message); return; }
      setLead(data as any);
    } else {
      const { data, error } = await supabase.from("leads").insert({
        workspace_id: workspaceId, contact_id: active.contact_id, stage: patch.stage ?? "new", notes: patch.notes ?? null,
      }).select().single();
      if (error) { toast.error(error.message); return; }
      setLead(data as any);
    }
    toast.success("Lead updated");
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col p-4 gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Search name or phone" value={search} onChange={(e) => setSearch(e.target.value)} className="w-64" />
        <Select value={channelFilter} onValueChange={(v) => setChannelFilter(v as any)}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All channels</SelectItem>
            <SelectItem value="whatsapp">WhatsApp</SelectItem>
            <SelectItem value="messenger">Messenger</SelectItem>
            <SelectItem value="instagram">Instagram</SelectItem>
          </SelectContent>
        </Select>
        <Select value={aiFilter} onValueChange={(v) => setAiFilter(v as AiFilter)}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">AI & Human</SelectItem>
            <SelectItem value="ai">AI mode</SelectItem>
            <SelectItem value="human">Human mode</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Switch id="unread" checked={unreadOnly} onCheckedChange={setUnreadOnly} />
          <Label htmlFor="unread">Unread only</Label>
        </div>
        <TestVpsSendButton />
      </div>


      <div className="grid flex-1 min-h-0 grid-cols-1 md:grid-cols-[280px_1fr_300px] gap-4">
        <Card className="flex flex-col min-h-0">
          <CardHeader className="py-3"><CardTitle className="text-sm">Conversations</CardTitle></CardHeader>
          <CardContent className="flex-1 min-h-0 p-0">
            <ScrollArea className="h-full">
              {loading ? (
                <div className="flex items-center justify-center p-6"><Loader2 className="h-4 w-4 animate-spin" /></div>
              ) : filtered.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  <Inbox className="mx-auto mb-2 h-8 w-8 opacity-50" />
                  No conversations yet. Connect a channel to start receiving messages.
                </div>
              ) : (
                <ul className="divide-y">
                  {filtered.map((c) => (
                    <li key={c.id}>
                      <button onClick={() => loadConversation(c.id)}
                        className={`w-full p-3 text-left hover:bg-accent ${activeId === c.id ? "bg-accent" : ""}`}>
                        <div className="flex items-center justify-between">
                          <span className="font-medium truncate">{c.contact?.name ?? c.contact?.phone ?? "Unknown"}</span>
                          {c.unread_count > 0 && <Badge variant="default">{c.unread_count}</Badge>}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>{c.channel?.type ?? "—"}</span>
                          {c.contact?.phone && <span>· {c.contact.phone}</span>}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        <Card className="flex flex-col min-h-0">
          <CardHeader className="py-3">
            <CardTitle className="text-sm">
              {active ? (active.contact?.name ?? active.contact?.phone ?? "Conversation") : "Select a conversation"}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 min-h-0 flex flex-col p-0">
            <ScrollArea className="flex-1 p-4">
              {!active ? (
                <div className="text-sm text-muted-foreground">Pick a conversation to view messages.</div>
              ) : messages.length === 0 ? (
                <div className="text-sm text-muted-foreground">No messages yet.</div>
              ) : (
                <div className="space-y-2">
                  {messages.map((m) => (
                    <div key={m.id} className={`flex ${m.direction === "outbound" ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                        m.direction === "outbound"
                          ? m.sender === "ai" ? "bg-primary/20 text-foreground" : "bg-primary text-primary-foreground"
                          : "bg-muted"}`}>
                        <div className="text-[10px] opacity-70 mb-0.5 flex items-center gap-1">
                          <span>{m.sender}</span>
                          {m.direction === "outbound" && m.delivery_status && (
                            <Badge
                              variant={
                                m.delivery_status === "failed"
                                  ? "destructive"
                                  : m.delivery_status === "delivered"
                                  ? "default"
                                  : m.delivery_status === "sent"
                                  ? "secondary"
                                  : "outline"
                              }
                              className="text-[9px] px-1 py-0 h-auto"
                            >
                              {m.delivery_status}
                            </Badge>
                          )}
                        </div>
                        <div className="whitespace-pre-wrap">{m.body}</div>
                        {m.direction === "outbound" && m.delivery_error && (
                          <pre className="mt-1 max-w-full whitespace-pre-wrap break-words rounded border border-border/60 bg-background/40 p-1 text-[10px] text-foreground">
                            {m.delivery_error}
                          </pre>
                        )}
                        {m.direction === "outbound" && m.target_jid && (
                          <div className="text-[10px] mt-1 opacity-70">→ {m.target_jid}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
            {active && (
              <div className="border-t p-3 flex gap-2">
                <Textarea value={reply} onChange={(e) => setReply(e.target.value)}
                  placeholder="Type a reply…" rows={2} className="resize-none" />
                <Button onClick={sendReply} disabled={sending || !reply.trim()}>
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="flex flex-col min-h-0">
          <CardHeader className="py-3"><CardTitle className="text-sm">Contact & Lead</CardTitle></CardHeader>
          <CardContent className="flex-1 min-h-0 overflow-auto space-y-4 text-sm">
            {!active ? (
              <p className="text-muted-foreground">No conversation selected.</p>
            ) : (
              <>
                <div className="space-y-1">
                  <div><span className="text-muted-foreground">Name: </span>{active.contact?.name ?? "—"}</div>
                  <div><span className="text-muted-foreground">Phone: </span>{active.contact?.phone ?? "—"}</div>
                  <div className="text-xs"><span className="text-muted-foreground">Send target: </span><code>{active.contact?.phone ?? active.contact?.remote_jid ?? active.remote_jid ?? "—"}</code></div>
                  <div><span className="text-muted-foreground">Email: </span>{active.contact?.email ?? "—"}</div>
                  <div><span className="text-muted-foreground">Channel: </span>{active.channel?.type ?? "—"}</div>
                </div>
                <div className="flex items-center justify-between rounded-md border p-2">
                  <Label htmlFor="ai-toggle">AI mode</Label>
                  <Switch id="ai-toggle" checked={!!active.contact?.ai_enabled}
                    onCheckedChange={toggleAi} />
                </div>
                <div className="space-y-2">
                  <Label>Lead stage</Label>
                  <Select value={lead?.stage ?? "new"} onValueChange={(v) => updateLead({ stage: v as LeadStage })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STAGES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Notes</Label>
                  <Textarea value={lead?.notes ?? ""} rows={4}
                    onChange={(e) => setLead((l) => l ? { ...l, notes: e.target.value } : { id: "", stage: "new", notes: e.target.value, value: 0 })} />
                  <Button size="sm" onClick={() => updateLead({ notes: lead?.notes ?? "" })}>Save notes</Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function TestVpsSendButton() {
  const runTestVpsSend = useServerFn(testVpsSend);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await runTestVpsSend({ data: { to: "94740123466", message: "Test from Lovable" } });
      setResult(`HTTP ${res.status}\n${res.raw || JSON.stringify(res.body)}`);
      toast.success("Test VPS Send ok");
    } catch (e: any) {
      const message = e?.message ?? String(e);
      setResult(`ERROR: ${message}`);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="outline" onClick={run} disabled={loading}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Test VPS Send"}
      </Button>
      {result && (
        <pre className="max-w-[480px] overflow-auto rounded border bg-muted p-2 text-xs whitespace-pre-wrap">
          {result}
        </pre>
      )}
    </div>
  );
}
