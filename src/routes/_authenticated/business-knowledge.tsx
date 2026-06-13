import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, Save } from "lucide-react";

export const Route = createFileRoute("/_authenticated/business-knowledge")({
  component: BusinessKnowledgePage,
});

const PROFILE_TITLE = "business_profile";

const schema = z.object({
  business_name: z.string().trim().min(1, "Business name is required").max(200),
  business_description: z.string().trim().max(2000).optional().or(z.literal("")),
  services: z.string().trim().max(4000).optional().or(z.literal("")),
  pricing: z.string().trim().max(4000).optional().or(z.literal("")),
  faqs: z.string().trim().max(8000).optional().or(z.literal("")),
  contact_number: z.string().trim().max(40).optional().or(z.literal("")),
  email: z.string().trim().max(255).email("Invalid email").optional().or(z.literal("")),
  website: z.string().trim().max(255).url("Invalid URL").optional().or(z.literal("")),
  business_address: z.string().trim().max(500).optional().or(z.literal("")),
  appointment_link: z.string().trim().max(255).url("Invalid URL").optional().or(z.literal("")),
  working_hours: z.string().trim().max(500).optional().or(z.literal("")),
});

type FormState = z.infer<typeof schema>;

const empty: FormState = {
  business_name: "",
  business_description: "",
  services: "",
  pricing: "",
  faqs: "",
  contact_number: "",
  email: "",
  website: "",
  business_address: "",
  appointment_link: "",
  working_hours: "",
};

function BusinessKnowledgePage() {
  const [form, setForm] = useState<FormState>(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [rowId, setRowId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("workspace_id")
        .eq("id", userData.user.id)
        .maybeSingle();
      if (!profile?.workspace_id) {
        setLoading(false);
        return;
      }
      setWorkspaceId(profile.workspace_id);
      const { data: row } = await supabase
        .from("business_knowledge")
        .select("id, content")
        .eq("workspace_id", profile.workspace_id)
        .eq("title", PROFILE_TITLE)
        .maybeSingle();
      if (row) {
        setRowId(row.id);
        try {
          const parsed = JSON.parse(row.content);
          setForm({ ...empty, ...parsed });
        } catch {
          /* ignore */
        }
      }
      setLoading(false);
    })();
  }, []);

  const update = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSave = async () => {
    const result = schema.safeParse(form);
    if (!result.success) {
      const fe: Record<string, string> = {};
      for (const issue of result.error.issues) fe[issue.path[0] as string] = issue.message;
      setErrors(fe);
      toast.error("Please fix the highlighted fields");
      return;
    }
    setErrors({});
    if (!workspaceId) {
      toast.error("No workspace found");
      return;
    }
    setSaving(true);
    const payload = {
      workspace_id: workspaceId,
      title: PROFILE_TITLE,
      category: "profile",
      content: JSON.stringify(result.data),
    };
    const { data, error } = rowId
      ? await supabase.from("business_knowledge").update(payload).eq("id", rowId).select("id").maybeSingle()
      : await supabase.from("business_knowledge").insert(payload).select("id").maybeSingle();
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (data?.id) setRowId(data.id);
    toast.success("Business profile saved");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const field = (
    name: keyof FormState,
    label: string,
    opts: { textarea?: boolean; type?: string; placeholder?: string } = {},
  ) => (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      {opts.textarea ? (
        <Textarea id={name} value={form[name] ?? ""} onChange={update(name)} rows={4} placeholder={opts.placeholder} />
      ) : (
        <Input id={name} type={opts.type ?? "text"} value={form[name] ?? ""} onChange={update(name)} placeholder={opts.placeholder} />
      )}
      {errors[name] && <p className="text-xs text-destructive">{errors[name]}</p>}
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Business Knowledge</h1>
        <p className="text-sm text-muted-foreground">
          Information the AI sales agent uses to answer customers.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Business Profile</CardTitle>
          <CardDescription>{rowId ? "Edit your existing profile" : "Create your business profile"}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {field("business_name", "Business Name")}
          {field("business_description", "Business Description", { textarea: true })}
          {field("services", "Services", { textarea: true, placeholder: "List the services you offer" })}
          {field("pricing", "Pricing", { textarea: true, placeholder: "Pricing details / packages" })}
          {field("faqs", "FAQs", { textarea: true, placeholder: "Q: ...\nA: ..." })}
          <div className="grid gap-4 md:grid-cols-2">
            {field("contact_number", "Contact Number", { type: "tel" })}
            {field("email", "Email", { type: "email" })}
            {field("website", "Website", { type: "url", placeholder: "https://" })}
            {field("appointment_link", "Appointment Link", { type: "url", placeholder: "https://" })}
          </div>
          {field("business_address", "Business Address", { textarea: true })}
          {field("working_hours", "Working Hours", { textarea: true, placeholder: "Mon–Fri 9:00–17:00" })}

          <div className="flex justify-end pt-2">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              {rowId ? "Save Changes" : "Create Profile"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
