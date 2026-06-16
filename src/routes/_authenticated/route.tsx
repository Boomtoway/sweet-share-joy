import { createFileRoute, Outlet, redirect, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { useRole } from "@/hooks/use-role";
import { useSubscription } from "@/hooks/use-subscription";

const CLIENT_ALLOWED = new Set([
  "/dashboard",
  "/leads",
  "/appointments",
  "/invoices",
  "/revenue",
  "/settings",
  "/billing",
  "/subscription-expired",
]);

// Routes blocked when the current user's subscription is expired.
const SUBSCRIPTION_BLOCKED = [
  "/whatsapp",
  "/ai-settings",
  "/leads",
  "/crm",
  "/dashboard",
];


export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { role, loading: roleLoading } = useRole();
  const { expired, loading: subLoading } = useSubscription();
  const pathname = useRouterState({ select: (r) => r.location.pathname });

  useEffect(() => {
    if (roleLoading || !role) return;
    if (role === "client" && !CLIENT_ALLOWED.has(pathname)) {
      navigate({ to: "/dashboard", replace: true });
    }
  }, [role, roleLoading, pathname, navigate]);

  useEffect(() => {
    if (subLoading) return;
    if (!expired) return;
    if (pathname === "/subscription-expired") return;
    if (SUBSCRIPTION_BLOCKED.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
      navigate({ to: "/subscription-expired", replace: true });
    }
  }, [expired, subLoading, pathname, navigate]);


  const handleSignOut = async () => {
    await signOut();
    navigate({ to: "/auth", replace: true });
  };

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col">
          <header className="h-14 border-b border-border flex items-center justify-between px-3 backdrop-blur-md bg-background/70 sticky top-0 z-30">
            <div className="flex items-center gap-2">
              <SidebarTrigger />
              <span className="text-sm text-muted-foreground hidden sm:inline">
                Welcome back, {user?.email}
              </span>
            </div>
            <Button variant="ghost" size="sm" onClick={handleSignOut}>
              <LogOut className="h-4 w-4 mr-2" /> Sign out
            </Button>
          </header>
          <main className="flex-1 p-4 md:p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
