import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export type AppRole = "admin" | "client";

export function useRole() {
  const { user, loading: authLoading } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ["user-role", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id);
      if (error) throw error;
      const roles = (data ?? []).map((r) => r.role as AppRole);
      return roles.includes("admin") ? "admin" : roles[0] ?? "client";
    },
    staleTime: 5 * 60_000,
  });
  return { role: data as AppRole | undefined, loading: authLoading || isLoading };
}
