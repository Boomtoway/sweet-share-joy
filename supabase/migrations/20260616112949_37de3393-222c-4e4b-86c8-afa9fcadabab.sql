
-- 1) Role enum
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin','client');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) Plan enum
DO $$ BEGIN
  CREATE TYPE public.client_plan AS ENUM ('starter','growth','pro');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3) Status enum
DO $$ BEGIN
  CREATE TYPE public.client_status AS ENUM ('active','disabled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 4) user_roles table
CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own roles" ON public.user_roles;
CREATE POLICY "Users can view own roles" ON public.user_roles
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- 5) has_role
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- 6) current_user_role helper
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS public.app_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT role FROM public.user_roles WHERE user_id = auth.uid()
  ORDER BY (role='admin')::int DESC LIMIT 1
$$;

-- 7) Extend profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS business_name text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS plan public.client_plan NOT NULL DEFAULT 'starter',
  ADD COLUMN IF NOT EXISTS status public.client_status NOT NULL DEFAULT 'active';

-- Profiles RLS: admin can read/update all profiles
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
CREATE POLICY "Admins can view all profiles" ON public.profiles
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS "Admins can update all profiles" ON public.profiles;
CREATE POLICY "Admins can update all profiles" ON public.profiles
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- 8) Update owns_workspace: admin sees all; workspace owners; profile membership
CREATE OR REPLACE FUNCTION public.owns_workspace(_workspace_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    public.has_role(auth.uid(),'admin')
    OR EXISTS (SELECT 1 FROM public.workspaces WHERE id=_workspace_id AND owner_id=auth.uid())
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id=auth.uid() AND workspace_id=_workspace_id)
$$;

-- 9) Bootstrap: make every existing user an admin (they were the sole owner before clients existed)
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role FROM auth.users
ON CONFLICT DO NOTHING;

-- 10) handle_new_user: keep workspace creation, but if signup metadata says role=client AND workspace_id provided, attach to that workspace and skip ai_settings dup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  new_workspace_id uuid;
  meta_role text;
  meta_workspace uuid;
  meta_business text;
  meta_plan text;
BEGIN
  meta_role := NEW.raw_user_meta_data->>'app_role';
  meta_workspace := NULLIF(NEW.raw_user_meta_data->>'workspace_id','')::uuid;
  meta_business := NEW.raw_user_meta_data->>'business_name';
  meta_plan := COALESCE(NEW.raw_user_meta_data->>'plan','starter');

  IF meta_role = 'client' AND meta_workspace IS NOT NULL THEN
    new_workspace_id := meta_workspace;
  ELSE
    INSERT INTO public.workspaces (owner_id, name)
    VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'workspace_name', COALESCE(meta_business,'My Workspace')))
    RETURNING id INTO new_workspace_id;
    INSERT INTO public.ai_settings (workspace_id) VALUES (new_workspace_id)
      ON CONFLICT DO NOTHING;
  END IF;

  INSERT INTO public.profiles (id, workspace_id, full_name, email, business_name, plan)
  VALUES (
    NEW.id, new_workspace_id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NEW.email, meta_business, meta_plan::public.client_plan
  );

  IF meta_role = 'client' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'client') ON CONFLICT DO NOTHING;
  ELSE
    -- self-signups become admin of their own workspace (preserves existing behaviour)
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin') ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END $function$;
