import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import { checkMySubscription } from "@/lib/subscriptions/subscriptions.functions";

export function useSubscription() {
  const { user } = useAuth();
  const check = useServerFn(checkMySubscription);
  const { data, isLoading } = useQuery({
    queryKey: ["my-subscription-check", user?.id],
    enabled: !!user?.id,
    queryFn: () => check(),
    staleTime: 60_000,
  });
  return {
    subscription: (data as any)?.subscription ?? null,
    expired: (data as any)?.expired ?? false,
    loading: isLoading,
  };
}
