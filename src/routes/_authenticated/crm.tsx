import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Loader2, Search, MessageCircle, TrendingUp, DollarSign, Target, CalendarClock, Trash2, RefreshCw, Wrench } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { syncConversationsToCrm, repairCrmData } from "@/lib/crm/crm.functions";

export const Route = createFileRoute("/_authenticated/crm")({
  component: CrmPage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">{error.message}</div>,
  notFoundComponent: () => <div className="p-6">Not found</div>,
});

type Stage = "new" | "interested" | "appointment_booked" | "proposal" | "negotiation" | "won" | "lost";

const STAGES: { id: Stage; label: string; color: string }[] = [
  { id: "new", label: "New Lead", color: "bg-slate-500" },
  { id: "interested", label: "Interested", color: "bg-blue-500" },
  { id: "appointment_booked", label: "Appointment Booked", color: "bg-violet-500" },
  { id: "proposal", label: "Proposal Sent", color: "bg-amber-500" },
  { id: "negotiation", label: "Negotiation", color: "bg-orange-500" },
  { id: "won", label: "Won", color: "bg-emerald-600" },
  { id: "lost", label: "Lost", color: "bg-rose-600" },
];

interface Lead {
  id: string;
  workspace_id: string;
  stage: Stage;
  name: string | null;
  phone: string | null;
  email: string | null;
  business_name: string | null;
  service_interest: string | null;
  source: string | null;
  budget: string | null;
  notes: string | null;
  last_message: string | null;
  appointment_date: string | null;
  follow_up_date: string | null;
  stage_changed_at: string | null;
  value: number;
  lead_score: number | null;
  ai_summary: string | null;
  created_at: string;
}

function scoreColor(s: number) {
  if (s >= 80) return "bg-emerald-600 text-white";
  if (s >= 50) return "bg-amber-500 text-white";
  if (s >= 20) return "bg-sky-500 text-white";
  return "bg-slate-400 text-white";
}

function scoreLabel(s: number) {
  if (s >= 80) return "Hot";
  if (s >= 50) return "Warm";
  if (s >= 20) return "Cool";
  return "Cold";
}

function fmtCurrency(n: number) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "LKR", maximumFractionDigits: 0 }).format(n || 0);
}

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function waLink(phone: string | null, text?: string) {
  if (!phone) return "#";
  const digits = phone.replace(/\D/g, "");
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

function CrmPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [search, setSearch] = useState("");
  const [active, setActive] = useState<Lead | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const syncFn = useServerFn(syncConversationsToCrm);
  const repairFn = useServerFn(repairCrmData);

  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      const { data: p } = await supabase.from("profiles").select("workspace_id").eq("id", auth.user.id).single();
      if (p?.workspace_id) setWorkspaceId(p.workspace_id);
    })();
  }, []);

  const load = async (ws: string) => {
    setLoading(true);
    const { data, error } = await supabase
      .from("leads").select("*").eq("workspace_id", ws)
      .order("stage_changed_at", { ascending: false });
    setLoading(false);
    if (error) toast.error(error.message);
    else setLeads((data ?? []) as any);
  };
  useEffect(() => { if (workspaceId) load(workspaceId); }, [workspaceId]);

  // Realtime updates so auto stage changes from the webhook show instantly.
  useEffect(() => {
    if (!workspaceId) return;
    const ch = supabase.channel(`crm-leads-${workspaceId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "leads", filter: `workspace_id=eq.${workspaceId}` },
        (payload) => {
          const tag = payload.eventType === "INSERT" ? "CRM_CREATE" : payload.eventType === "UPDATE" ? "CRM_UPDATE" : "CRM_SYNC";
          console.log(tag, payload.new ?? payload.old);
          load(workspaceId);
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [workspaceId]);

  const filtered = useMemo(() => leads.filter((l) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return [l.name, l.phone, l.email, l.business_name, l.service_interest, l.notes].join(" ").toLowerCase().includes(q);
  }), [leads, search]);

  const byStage = useMemo(() => {
    const map = Object.fromEntries(STAGES.map((s) => [s.id, [] as Lead[]])) as Record<Stage, Lead[]>;
    for (const l of filtered) map[l.stage]?.push(l);
    return map;
  }, [filtered]);

  const moveStage = async (id: string, stage: Stage) => {
    const prev = leads.find((l) => l.id === id);
    if (!prev || prev.stage === stage) return;
    setLeads((ls) => ls.map((l) => l.id === id ? { ...l, stage } : l));
    const { error } = await supabase.from("leads").update({ stage }).eq("id", id);
    if (error) { toast.error(error.message); setLeads((ls) => ls.map((l) => l.id === id ? { ...l, stage: prev.stage } : l)); }
    else toast.success(`Moved to ${STAGES.find((s) => s.id === stage)?.label}`);
  };

  const saveActive = async (patch: Partial<Lead>) => {
    if (!active) return;
    const next = { ...active, ...patch };
    setActive(next);
    setLeads((ls) => ls.map((l) => l.id === active.id ? next : l));
    const { error } = await supabase.from("leads").update(patch as any).eq("id", active.id);
    if (error) toast.error(error.message);
  };

  const deleteLead = async (id: string) => {
    if (!confirm("Delete this lead?")) return;
    const { error } = await supabase.from("leads").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    setLeads((ls) => ls.filter((l) => l.id !== id));
    setActive(null);
    toast.success("Lead deleted");
  };

  // Analytics
  const total = leads.length;
  const won = byStage.won.length;
  const lost = byStage.lost.length;
  const decided = won + lost;
  const conversion = decided ? Math.round((won / decided) * 100) : 0;
  const revenueWon = byStage.won.reduce((s, l) => s + Number(l.value ?? 0), 0);
  const pipelineValue = leads
    .filter((l) => l.stage !== "won" && l.stage !== "lost")
    .reduce((s, l) => s + Number(l.value ?? 0), 0);
  const dueSoon = leads.filter((l) => l.follow_up_date && new Date(l.follow_up_date).getTime() <= Date.now() + 86400000).length;

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-4 p-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard icon={<Target className="h-4 w-4" />} label="Total leads" value={String(total)} />
        <StatCard icon={<TrendingUp className="h-4 w-4 text-emerald-600" />} label="Conversion" value={`${conversion}%`} hint={`${won} won / ${decided} closed`} />
        <StatCard icon={<DollarSign className="h-4 w-4 text-emerald-600" />} label="Revenue won" value={fmtCurrency(revenueWon)} />
        <StatCard icon={<DollarSign className="h-4 w-4 text-amber-600" />} label="Pipeline value" value={fmtCurrency(pipelineValue)} />
        <StatCard icon={<CalendarClock className="h-4 w-4 text-violet-600" />} label="Follow-ups due ≤24h" value={String(dueSoon)} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8 w-72" placeholder="Search name, phone, notes…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={syncing}
          onClick={async () => {
            setSyncing(true);
            try {
              const r = await syncFn();
              console.log("CRM_SYNC", r);
              toast.success(`Synced: ${r.created} new, ${r.updated} updated, ${r.removed} cleaned`);
              if (workspaceId) await load(workspaceId);
            } catch (e: any) {
              toast.error(e?.message ?? "Sync failed");
            } finally {
              setSyncing(false);
            }
          }}
        >
          {syncing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
          Sync Conversations
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={repairing}
          onClick={async () => {
            setRepairing(true);
            try {
              const r = await repairFn();
              console.log("CRM_SYNC", r);
              toast.success(
                `Repaired: ${r.names_updated} names, ${r.phones_updated} phones, ${r.last_messages_updated} messages · merged ${r.duplicates_removed} duplicates · removed ${r.empty_leads_deleted} empty`,
                { duration: 6000 },
              );
              if (workspaceId) await load(workspaceId);
            } catch (e: any) {
              toast.error(e?.message ?? "Repair failed");
            } finally {
              setRepairing(false);
            }
          }}
        >
          {repairing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Wrench className="h-4 w-4 mr-1" />}
          Repair CRM Data
        </Button>
        <div className="ml-auto text-xs text-muted-foreground">
          Drag cards between columns. Stages auto-detect from AI conversations.
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center p-10"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : (
          <div className="grid grid-flow-col auto-cols-[300px] gap-3 h-full pb-2">
            {STAGES.map((stage) => {
              const items = byStage[stage.id] ?? [];
              const stageValue = items.reduce((s, l) => s + Number(l.value ?? 0), 0);
              return (
                <div key={stage.id}
                  className="flex flex-col rounded-lg border bg-muted/30 min-h-0"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    const id = e.dataTransfer.getData("text/plain");
                    if (id) moveStage(id, stage.id);
                  }}>
                  <div className="flex items-center justify-between px-3 py-2 border-b">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${stage.color}`} />
                      <div className="text-sm font-medium">{stage.label}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{fmtCurrency(stageValue)}</span>
                      <Badge variant="secondary">{items.length}</Badge>
                    </div>
                  </div>
                  <div className="flex-1 overflow-auto p-2 space-y-2">
                    {items.length === 0 && <div className="text-xs text-muted-foreground py-6 text-center">Drop leads here</div>}
                    {items.map((l) => (
                      <div key={l.id}
                        draggable
                        onDragStart={(e) => e.dataTransfer.setData("text/plain", l.id)}
                        onClick={() => setActive(l)}
                        className="cursor-grab rounded-md border bg-card p-3 shadow-sm hover:border-primary transition-colors">
                        <div className="flex items-start justify-between gap-2">
                          <div className="font-medium text-sm truncate">{l.name || l.phone || l.business_name || "Unknown"}</div>
                          <div className="flex items-center gap-1 shrink-0">
                            <Badge className={`${scoreColor(l.lead_score ?? 0)} text-[10px] px-1.5 py-0`}>
                              🔥 {l.lead_score ?? 0} · {scoreLabel(l.lead_score ?? 0)}
                            </Badge>
                            {l.value > 0 && <Badge variant="outline">{fmtCurrency(Number(l.value))}</Badge>}
                          </div>
                        </div>
                        {l.phone && <div className="text-xs text-muted-foreground truncate">📞 {l.phone}</div>}
                        {l.business_name && <div className="text-xs text-muted-foreground truncate">🏢 {l.business_name}</div>}
                        {l.service_interest && <div className="text-xs text-muted-foreground truncate mt-0.5">📌 {l.service_interest}</div>}
                        {l.budget && <div className="text-xs text-emerald-600 truncate mt-0.5">💰 Budget: {l.budget}</div>}
                        {l.ai_summary && <div className="text-[11px] text-muted-foreground truncate mt-1">🤖 {l.ai_summary}</div>}
                        {l.last_message && <div className="text-xs text-muted-foreground italic truncate mt-1">"{l.last_message}"</div>}
                        <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                          <span className="truncate">{l.source ?? "—"}</span>
                          {l.follow_up_date && <span className="ml-2 shrink-0">📅 {fmtDate(l.follow_up_date)}</span>}
                        </div>
                        {l.phone && (
                          <a
                            href={waLink(l.phone, `Hi ${l.name ?? "there"}, following up on our conversation.`)}
                            target="_blank" rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="mt-2 inline-flex items-center gap-1 text-xs text-emerald-600 hover:underline">
                            <MessageCircle className="h-3 w-3" />WhatsApp
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Sheet open={!!active} onOpenChange={(o) => !o && setActive(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-auto">
          <SheetHeader><SheetTitle>Lead details</SheetTitle></SheetHeader>
          {active && (
            <div className="mt-4 space-y-3">
              <Field label="Name"><Input value={active.name ?? ""} onChange={(e) => saveActive({ name: e.target.value })} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Phone"><Input value={active.phone ?? ""} onChange={(e) => saveActive({ phone: e.target.value })} /></Field>
                <Field label="Email"><Input value={active.email ?? ""} onChange={(e) => saveActive({ email: e.target.value })} /></Field>
              </div>
              <Field label="Business name"><Input value={active.business_name ?? ""} onChange={(e) => saveActive({ business_name: e.target.value })} /></Field>
              <Field label="Service interest"><Input value={active.service_interest ?? ""} onChange={(e) => saveActive({ service_interest: e.target.value })} /></Field>
              <Field label="Budget"><Input value={active.budget ?? ""} placeholder="e.g. LKR 50000" onChange={(e) => saveActive({ budget: e.target.value })} /></Field>


              <div className="grid grid-cols-2 gap-3">
                <Field label="Stage">
                  <Select value={active.stage} onValueChange={(v) => saveActive({ stage: v as Stage })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{STAGES.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field label="Lead value (LKR)">
                  <Input type="number" min={0} value={active.value ?? 0}
                    onChange={(e) => saveActive({ value: Number(e.target.value) || 0 })} />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Follow-up date">
                  <Input type="datetime-local"
                    value={active.follow_up_date ? active.follow_up_date.slice(0, 16) : ""}
                    onChange={(e) => saveActive({ follow_up_date: e.target.value ? new Date(e.target.value).toISOString() : null })} />
                </Field>
                <Field label="Appointment date">
                  <Input type="datetime-local"
                    value={active.appointment_date ? active.appointment_date.slice(0, 16) : ""}
                    onChange={(e) => saveActive({ appointment_date: e.target.value ? new Date(e.target.value).toISOString() : null })} />
                </Field>
              </div>

              <Field label="Notes">
                <Textarea rows={5} value={active.notes ?? ""} onChange={(e) => saveActive({ notes: e.target.value })} />
              </Field>

              <div className="flex flex-wrap gap-2 pt-2">
                {active.phone && (
                  <Button asChild variant="secondary">
                    <a href={waLink(active.phone, `Hi ${active.name ?? "there"},`)} target="_blank" rel="noreferrer">
                      <MessageCircle className="h-4 w-4 mr-1" />Message on WhatsApp
                    </a>
                  </Button>
                )}
                <Button variant="destructive" onClick={() => deleteLead(active.id)}>
                  <Trash2 className="h-4 w-4 mr-1" />Delete lead
                </Button>
              </div>
              <div className="text-xs text-muted-foreground pt-2">
                Stage last changed {active.stage_changed_at ? new Date(active.stage_changed_at).toLocaleString() : "—"}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function StatCard({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon}{label}</div>
        <div className="text-2xl font-semibold mt-1">{value}</div>
        {hint && <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
