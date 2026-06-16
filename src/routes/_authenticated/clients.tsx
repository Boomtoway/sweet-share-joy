import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import {
  listClients,
  createClient as createClientFn,
  updateClient,
  listWorkspaces,
} from "@/lib/clients/clients.functions";
import { useRole } from "@/hooks/use-role";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, Users } from "lucide-react";

export const Route = createFileRoute("/_authenticated/clients")({
  head: () => ({ meta: [{ title: "Clients — Admin" }] }),
  component: ClientsPage,
});

function ClientsPage() {
  const { role, loading } = useRole();
  const navigate = useNavigate();
  useEffect(() => {
    if (!loading && role !== "admin") navigate({ to: "/dashboard", replace: true });
  }, [role, loading, navigate]);

  const list = useServerFn(listClients);
  const wsList = useServerFn(listWorkspaces);
  const create = useServerFn(createClientFn);
  const update = useServerFn(updateClient);
  const qc = useQueryClient();

  const clientsQ = useQuery({ queryKey: ["admin-clients"], queryFn: () => list(), enabled: role === "admin" });
  const wsQ = useQuery({ queryKey: ["admin-workspaces"], queryFn: () => wsList(), enabled: role === "admin" });

  const createMut = useMutation({
    mutationFn: (data: any) => create({ data }),
    onSuccess: () => {
      toast.success("Client created");
      qc.invalidateQueries({ queryKey: ["admin-clients"] });
      setOpen(false);
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to create"),
  });

  const updateMut = useMutation({
    mutationFn: (data: any) => update({ data }),
    onSuccess: () => {
      toast.success("Updated");
      qc.invalidateQueries({ queryKey: ["admin-clients"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to update"),
  });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    full_name: "", email: "", password: "", business_name: "",
    plan: "starter" as "starter" | "growth" | "pro",
    workspace_id: "__new__" as string,
    workspace_name: "",
  });

  if (loading || role !== "admin") return null;

  const clients = (clientsQ.data as any)?.clients ?? [];
  const workspaces = (wsQ.data as any)?.workspaces ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="h-6 w-6" /> Clients
          </h1>
          <p className="text-sm text-muted-foreground">Manage client accounts and workspaces</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" />New Client</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Client Account</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Full name</Label>
                <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Password</Label>
                <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Business name</Label>
                <Input value={form.business_name} onChange={(e) => setForm({ ...form, business_name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Plan</Label>
                  <Select value={form.plan} onValueChange={(v: any) => setForm({ ...form, plan: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="starter">Starter</SelectItem>
                      <SelectItem value="growth">Growth</SelectItem>
                      <SelectItem value="pro">Pro</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Workspace</Label>
                  <Select value={form.workspace_id} onValueChange={(v) => setForm({ ...form, workspace_id: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__new__">+ Create new workspace</SelectItem>
                      {workspaces.map((w: any) => (
                        <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {form.workspace_id === "__new__" && (
                <div className="space-y-2">
                  <Label>New workspace name</Label>
                  <Input
                    placeholder="Defaults to business name"
                    value={form.workspace_name}
                    onChange={(e) => setForm({ ...form, workspace_name: e.target.value })}
                  />
                </div>
              )}
            </div>
            <DialogFooter>
              <Button
                onClick={() => {
                  const payload: any = { ...form };
                  if (form.workspace_id === "__new__") {
                    payload.workspace_id = null;
                    payload.workspace_name = form.workspace_name || form.business_name;
                  }
                  createMut.mutate(payload);
                }}
                disabled={createMut.isPending}
              >
                {createMut.isPending ? "Creating..." : "Create Client"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader><CardTitle>All clients</CardTitle></CardHeader>
        <CardContent>
          {clientsQ.isLoading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : clients.length === 0 ? (
            <div className="text-sm text-muted-foreground">No clients yet.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Business</TableHead>
                  <TableHead>Workspace</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clients.map((c: any) => (
                  <TableRow key={c.id}>
                    <TableCell>{c.full_name}</TableCell>
                    <TableCell>{c.email}</TableCell>
                    <TableCell>{c.business_name}</TableCell>
                    <TableCell>{c.workspaces?.name ?? "—"}</TableCell>
                    <TableCell>
                      <Select
                        value={c.plan}
                        onValueChange={(v) => updateMut.mutate({ id: c.id, plan: v })}
                      >
                        <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="starter">Starter</SelectItem>
                          <SelectItem value="growth">Growth</SelectItem>
                          <SelectItem value="pro">Pro</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={c.status === "active" ? "default" : "destructive"}
                        className="cursor-pointer"
                        onClick={() =>
                          updateMut.mutate({ id: c.id, status: c.status === "active" ? "disabled" : "active" })
                        }
                      >
                        {c.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
