import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function assertAdmin(context: any) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin only");
}

export const listClients = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: clientRoles, error: rErr } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("role", "client");
    if (rErr) throw new Error(rErr.message);
    const ids = (clientRoles ?? []).map((r) => r.user_id);
    if (ids.length === 0) return { clients: [] };
    const { data: profiles, error: pErr } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email, business_name, plan, status, workspace_id, created_at, workspaces:workspace_id(name)")
      .in("id", ids)
      .order("created_at", { ascending: false });
    if (pErr) throw new Error(pErr.message);
    return { clients: profiles ?? [] };
  });

const createSchema = z.object({
  full_name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email().max(255),
  password: z.string().min(6).max(200).optional(),
  business_name: z.string().trim().min(1).max(150),
  plan: z.enum(["starter", "growth", "pro"]),
  workspace_id: z.string().uuid().optional().nullable(),
  workspace_name: z.string().trim().min(1).max(150).optional(),
  send_invite: z.boolean().optional().default(false),
});

export const createClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => createSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (!data.password && !data.send_invite) {
      throw new Error("Provide a password or enable Send Invite Email");
    }

    // 1) Ensure workspace exists (create if needed). Track for rollback.
    let workspaceId = data.workspace_id ?? null;
    let createdWorkspace = false;
    if (!workspaceId) {
      const { data: ws, error: wErr } = await supabaseAdmin
        .from("workspaces")
        .insert({ owner_id: context.userId, name: data.workspace_name || data.business_name })
        .select("id")
        .single();
      if (wErr) throw new Error(`Workspace creation failed: ${wErr.message}`);
      workspaceId = ws.id;
      createdWorkspace = true;
      await supabaseAdmin.from("ai_settings").insert({ workspace_id: workspaceId });
    }

    // 2) Create the Supabase Auth user FIRST. If this fails, rollback workspace.
    let userId: string;
    let inviteSent = false;
    try {
      if (data.send_invite) {
        const { data: invited, error: iErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(
          data.email,
          {
            data: {
              full_name: data.full_name,
              business_name: data.business_name,
              plan: data.plan,
              app_role: "client",
              workspace_id: workspaceId,
            },
          }
        );
        if (iErr) throw new Error(`Auth invite failed: ${iErr.message}`);
        userId = invited.user!.id;
        inviteSent = true;
        if (data.password) {
          const { error: pErr } = await supabaseAdmin.auth.admin.updateUserById(userId, {
            password: data.password,
            email_confirm: true,
          });
          if (pErr) throw new Error(`Set password failed: ${pErr.message}`);
        }
      } else {
        const { data: created, error: cErr } = await supabaseAdmin.auth.admin.createUser({
          email: data.email,
          password: data.password,
          email_confirm: true,
          user_metadata: {
            full_name: data.full_name,
            business_name: data.business_name,
            plan: data.plan,
            app_role: "client",
            workspace_id: workspaceId,
          },
        });
        if (cErr) throw new Error(`Auth user creation failed: ${cErr.message}`);
        userId = created.user!.id;
      }
    } catch (e) {
      if (createdWorkspace && workspaceId) {
        await supabaseAdmin.from("ai_settings").delete().eq("workspace_id", workspaceId);
        await supabaseAdmin.from("workspaces").delete().eq("id", workspaceId);
      }
      throw e;
    }

    // 3) Sync profile + role (trigger creates them; we ensure correct values).
    try {
      await supabaseAdmin.from("profiles").update({
        workspace_id: workspaceId,
        full_name: data.full_name,
        email: data.email,
        business_name: data.business_name,
        plan: data.plan,
        status: "active",
      }).eq("id", userId);
      await supabaseAdmin.from("user_roles").upsert(
        { user_id: userId, role: "client" },
        { onConflict: "user_id,role" }
      );
    } catch (e) {
      // Rollback auth user + workspace so admin can retry cleanly
      await supabaseAdmin.auth.admin.deleteUser(userId);
      if (createdWorkspace && workspaceId) {
        await supabaseAdmin.from("ai_settings").delete().eq("workspace_id", workspaceId);
        await supabaseAdmin.from("workspaces").delete().eq("id", workspaceId);
      }
      throw new Error(`Profile setup failed: ${(e as Error).message}`);
    }

    return { id: userId, workspace_id: workspaceId, invite_sent: inviteSent };
  });

const resetPasswordSchema = z.object({
  id: z.string().uuid(),
  password: z.string().min(6).max(200),
});

export const resetClientPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => resetPasswordSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.id, {
      password: data.password,
      email_confirm: true,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const inviteSchema = z.object({ id: z.string().uuid() });

export const sendInviteEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => inviteSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: u, error: uErr } = await supabaseAdmin.auth.admin.getUserById(data.id);
    if (uErr || !u?.user?.email) throw new Error(uErr?.message ?? "User has no email");
    // Use password recovery link so existing users can reset/login without re-creating account
    const { error } = await supabaseAdmin.auth.admin.generateLink({
      type: "recovery",
      email: u.user.email,
    });
    if (error) throw new Error(`Send invite failed: ${error.message}`);
    return { ok: true, email: u.user.email };
  });

const updateSchema = z.object({
  id: z.string().uuid(),
  plan: z.enum(["starter", "growth", "pro"]).optional(),
  status: z.enum(["active", "disabled"]).optional(),
  business_name: z.string().trim().min(1).max(150).optional(),
  full_name: z.string().trim().min(1).max(100).optional(),
});

export const updateClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => updateSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { id, ...rest } = data;
    const { error } = await supabaseAdmin.from("profiles").update(rest).eq("id", id);
    if (error) throw new Error(error.message);

    if (data.status === "disabled") {
      await supabaseAdmin.auth.admin.updateUserById(id, { ban_duration: "876000h" });
    } else if (data.status === "active") {
      await supabaseAdmin.auth.admin.updateUserById(id, { ban_duration: "none" });
    }
    return { ok: true };
  });

export const listWorkspaces = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("workspaces")
      .select("id, name, created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { workspaces: data ?? [] };
  });
