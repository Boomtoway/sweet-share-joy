import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const CreateSchema = z.object({
  contact_id: z.string().uuid().nullable().optional(),
  conversation_id: z.string().uuid().nullable().optional(),
  name: z.string().min(1),
  phone: z.string().min(1),
  service_needed: z.string().nullable().optional(),
  appointment_date: z.string().min(1), // YYYY-MM-DD
  appointment_time: z.string().min(1), // HH:MM (24h)
  notes: z.string().nullable().optional(),
});

const UpdateStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["scheduled", "confirmed", "completed", "cancelled", "no_show"]),
});

async function workspaceId(context: any) {
  const { data: profile } = await context.supabase
    .from("profiles")
    .select("workspace_id")
    .eq("id", context.userId)
    .single();
  if (!profile?.workspace_id) throw new Error("Workspace not found");
  return profile.workspace_id as string;
}

export const listAppointments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const wsId = await workspaceId(context);
    const { data, error } = await context.supabase
      .from("appointments")
      .select("*, contact:contacts(id, name, phone)")
      .eq("workspace_id", wsId)
      .order("appointment_datetime", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

export const createAppointment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CreateSchema.parse(d))
  .handler(async ({ data, context }) => {
    const wsId = await workspaceId(context);
    const timeStr = data.appointment_time.length === 5 ? `${data.appointment_time}:00` : data.appointment_time;
    const dt = new Date(`${data.appointment_date}T${timeStr}`);
    const { data: row, error } = await context.supabase
      .from("appointments")
      .insert({
        workspace_id: wsId,
        contact_id: data.contact_id ?? null,
        conversation_id: data.conversation_id ?? null,
        name: data.name,
        phone: data.phone,
        service_needed: data.service_needed ?? null,
        appointment_date: data.appointment_date,
        appointment_time: timeStr,
        appointment_datetime: dt.toISOString(),
        starts_at: dt.toISOString(),
        title: data.service_needed || `Appointment with ${data.name}`,
        notes: data.notes ?? null,
        status: "scheduled",
      } as any)
      .select()
      .single();
    if (error) throw error;
    return row;
  });

export const updateAppointmentStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => UpdateStatusSchema.parse(d))
  .handler(async ({ data, context }) => {
    const wsId = await workspaceId(context);
    const { data: row, error } = await context.supabase
      .from("appointments")
      .update({ status: data.status })
      .eq("id", data.id)
      .eq("workspace_id", wsId)
      .select()
      .single();
    if (error) throw error;
    return row;
  });
