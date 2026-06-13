import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Loader2, Plus, Search, Trash2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/leads")({
  component: LeadsPage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">{error.message}</div>,
  notFoundComponent: () => <div className="p-6">Not found</div>,
});

type Stage = "new" | "qualified" | "interested" | "appointment_booked" | "won" | "lost";

const STAGES: { id: Stage; label: string }[] = [
  { id: "new", label: "New Lead" },
  { id: "qualified", label: "Qualified" },
  { id: "interested", label: "Interested" },
  { id: "appointment_booked", label: "Appointment Booked" },
  { id: "won", label: "Won" },
  { id: "lost", label: "Lost" },
];

interface Lead {
  id: string;
  workspace_id: string;
  stage: Stage;
  status: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  business_name: string | null;
  service_interest: string | null;
  source: string | null;
  budget: string | null;
  notes: string | null;
  assigned_to: string | null;
  appointment_date: string | null;
  lead_score: number;
  ai_summary: string | null;
  value: number;
  created_at: string;
}

const empty = (): Partial<Lead> => ({
  stage: "new", status: "open", name: "", phone: "", email: "", business_name: "",
  service_interest: "", source: "", budget: "", notes: "", appointment_date: null,
  lead_score: 0, ai_summary: "",
});

function LeadsPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [active, setActive] = useState<Lead | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState<Partial<Lead>>(empty());

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
    const { data, error } = await supabase.from("leads").select("*").eq("workspace_id", ws).order("created_at", { ascending: false });
    setLoading(false);
    if (error) toast.error(error.message);
    else setLeads((data ?? []) as any);
  };
  useEffect(() => { if (workspaceId) load(workspaceId); }, [workspaceId]);

  const sources = useMemo(() => Array.from(new Set(leads.map((l) => l.source).filter(Boolean))) as string[], [leads]);
  const statuses = useMemo(() => Array.from(new Set(leads.map((l) => l.status).filter(Boolean))) as string[], [leads]);

  const filtered = useMemo(() => leads.filter((l) => {
    if (sourceFilter !== "all" && (l.source ?? "") !== sourceFilter) return false;
    if (statusFilter !== "all" && (l.status ?? "") !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const hay = [l.name, l.phone, l.email, l.business_name, l.service_interest].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }), [leads, search, sourceFilter, statusFilter]);

  const byStage = useMemo(() => {
    const map: Record<Stage, Lead[]> = { new: [], qualified: [], interested: [], appointment_booked: [], won: [], lost: [] };
    for (const l of filtered) map[l.stage]?.push(l);
    return map;
  }, [filtered]);

  const moveStage = async (id: string, stage: Stage) => {
    const prev = leads.find((l) => l.id === id);
    if (!prev || prev.stage === stage) return;
    setLeads((ls) => ls.map((l) => l.id === id ? { ...l, stage } : l));
    const { error } = await supabase.from("leads").update({ stage }).eq("id", id);
    if (error) { toast.error(error.message); setLeads((ls) => ls.map((l) => l.id === id ? { ...l, stage: prev.stage } : l)); }
  };

  const saveActive = async (patch: Partial<Lead>) => {
    if (!active) return;
    const next = { ...active, ...patch };
    setActive(next);
    setLeads((ls) => ls.map((l) => l.id === active.id ? next : l));
    const { error } = await supabase.from("leads").update(patch as any).eq("id", active.id);
    if (error) toast.error(error.message);
  };

  const createLead = async () => {
    if (!workspaceId) return;
    const payload = { ...draft, workspace_id: workspaceId } as any;
    const { data, error } = await supabase.from("leads").insert(payload).select().single();
    if (error) { toast.error(error.message); return; }
    setLeads((ls) => [data as any, ...ls]);
    setCreateOpen(false);
    setDraft(empty());
    toast.success("Lead created");
  };

  const deleteLead = async (id: string) => {
    const { error } = await supabase.from("leads").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    setLeads((ls) => ls.filter((l) => l.id !== id));
    setActive(null);
    toast.success("Lead deleted");
  };

  const total = leads.length;
  const won = leads.filter((l) => l.stage === "won").length;
  const conversion = total ? Math.round((won / total) * 100) : 0;

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-4 p-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Total leads</div><div className="text-2xl font-semibold">{total}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Won</div><div className="text-2xl font-semibold">{won}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Conversion</div><div className="text-2xl font-semibold">{conversion}%</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Appointments</div><div className="text-2xl font-semibold">{leads.filter((l) => l.stage === "appointment_booked").length}</div></CardContent></Card>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8 w-64" placeholder="Search leads" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={sourceFilter} onValueChange={setSourceFilter}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Source" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            {sources.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {statuses.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="ml-auto">
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-1" />New lead</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>New lead</DialogTitle></DialogHeader>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Name"><Input value={draft.name ?? ""} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
                <Field label="Phone"><Input value={draft.phone ?? ""} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} /></Field>
                <Field label="Email"><Input value={draft.email ?? ""} onChange={(e) => setDraft({ ...draft, email: e.target.value })} /></Field>
                <Field label="Business"><Input value={draft.business_name ?? ""} onChange={(e) => setDraft({ ...draft, business_name: e.target.value })} /></Field>
                <Field label="Service interest"><Input value={draft.service_interest ?? ""} onChange={(e) => setDraft({ ...draft, service_interest: e.target.value })} /></Field>
                <Field label="Source"><Input value={draft.source ?? ""} onChange={(e) => setDraft({ ...draft, source: e.target.value })} /></Field>
                <Field label="Budget"><Input value={draft.budget ?? ""} onChange={(e) => setDraft({ ...draft, budget: e.target.value })} /></Field>
                <Field label="Stage">
                  <Select value={draft.stage} onValueChange={(v) => setDraft({ ...draft, stage: v as Stage })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{STAGES.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
              </div>
              <DialogFooter><Button onClick={createLead}>Create</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center p-10"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : leads.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No leads yet. Connect a channel to start collecting leads.
          </div>
        ) : (
          <div className="grid grid-flow-col auto-cols-[280px] gap-3 h-full">
            {STAGES.map((stage) => (
              <div key={stage.id}
                className="flex flex-col rounded-lg border bg-muted/30 min-h-0"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  const id = e.dataTransfer.getData("text/plain");
                  if (id) moveStage(id, stage.id);
                }}>
                <div className="flex items-center justify-between px-3 py-2 border-b">
                  <div className="text-sm font-medium">{stage.label}</div>
                  <Badge variant="secondary">{byStage[stage.id].length}</Badge>
                </div>
                <div className="flex-1 overflow-auto p-2 space-y-2">
                  {byStage[stage.id].map((l) => (
                    <div key={l.id}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData("text/plain", l.id)}
                      onClick={() => setActive(l)}
                      className="cursor-grab rounded-md border bg-card p-3 shadow-sm hover:border-primary">
                      <div className="font-medium text-sm truncate">{l.name || l.phone || "Untitled"}</div>
                      {l.business_name && <div className="text-xs text-muted-foreground truncate">{l.business_name}</div>}
                      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                        <span>{l.source ?? "—"}</span>
                        <Badge variant="outline">★ {l.lead_score}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Sheet open={!!active} onOpenChange={(o) => !o && setActive(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-auto">
          <SheetHeader><SheetTitle>Lead details</SheetTitle></SheetHeader>
          {active && (
            <div className="mt-4 space-y-3">
              <Field label="Name"><Input value={active.name ?? ""} onChange={(e) => saveActive({ name: e.target.value })} /></Field>
              <Field label="Phone"><Input value={active.phone ?? ""} onChange={(e) => saveActive({ phone: e.target.value })} /></Field>
              <Field label="Email"><Input value={active.email ?? ""} onChange={(e) => saveActive({ email: e.target.value })} /></Field>
              <Field label="Business name"><Input value={active.business_name ?? ""} onChange={(e) => saveActive({ business_name: e.target.value })} /></Field>
              <Field label="Service interest"><Input value={active.service_interest ?? ""} onChange={(e) => saveActive({ service_interest: e.target.value })} /></Field>
              <Field label="Source"><Input value={active.source ?? ""} onChange={(e) => saveActive({ source: e.target.value })} /></Field>
              <Field label="Budget"><Input value={active.budget ?? ""} onChange={(e) => saveActive({ budget: e.target.value })} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Stage">
                  <Select value={active.stage} onValueChange={(v) => saveActive({ stage: v as Stage })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{STAGES.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field label="Status">
                  <Select value={active.status ?? "open"} onValueChange={(v) => saveActive({ status: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open">Open</SelectItem>
                      <SelectItem value="in_progress">In progress</SelectItem>
                      <SelectItem value="closed">Closed</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Appointment date">
                  <Input type="datetime-local"
                    value={active.appointment_date ? active.appointment_date.slice(0, 16) : ""}
                    onChange={(e) => saveActive({ appointment_date: e.target.value ? new Date(e.target.value).toISOString() : null })} />
                </Field>
                <Field label="Lead score">
                  <Input type="number" value={active.lead_score}
                    onChange={(e) => saveActive({ lead_score: Number(e.target.value) || 0 })} />
                </Field>
              </div>
              <Field label="AI summary"><Textarea rows={3} value={active.ai_summary ?? ""} onChange={(e) => saveActive({ ai_summary: e.target.value })} /></Field>
              <Field label="Notes"><Textarea rows={4} value={active.notes ?? ""} onChange={(e) => saveActive({ notes: e.target.value })} /></Field>
              <Button variant="destructive" onClick={() => deleteLead(active.id)}><Trash2 className="h-4 w-4 mr-1" />Delete lead</Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
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
