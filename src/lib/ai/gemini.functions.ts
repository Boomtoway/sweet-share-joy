import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generateText } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "./gateway.server";

export const getGeminiStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const configured = !!process.env.LOVABLE_API_KEY;

    const { data: profile } = await context.supabase
      .from("profiles")
      .select("workspace_id")
      .eq("id", context.userId)
      .single();

    let totalTokens = 0;
    let requests = 0;
    let lastUsedAt: string | null = null;

    if (profile?.workspace_id) {
      const { data } = await context.supabase
        .from("bot_logs")
        .select("metadata, created_at")
        .eq("workspace_id", profile.workspace_id)
        .eq("bot_name", "gemini")
        .order("created_at", { ascending: false })
        .limit(500);

      for (const row of data ?? []) {
        const m = (row.metadata ?? {}) as { tokens?: number };
        totalTokens += Number(m.tokens ?? 0);
        requests += 1;
      }
      lastUsedAt = data?.[0]?.created_at ?? null;
    }

    return {
      configured,
      provider: "Lovable AI Gateway",
      defaultModel: "google/gemini-2.5-flash",
      totalTokens,
      requests,
      lastUsedAt,
    };
  });

const TestInput = z.object({
  prompt: z.string().min(1).max(500).optional(),
  model: z.string().optional(),
});

export const testGeminiConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => TestInput.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) {
      return { ok: false, error: "Gemini API key is not configured on the server." };
    }

    const { data: profile } = await context.supabase
      .from("profiles")
      .select("workspace_id")
      .eq("id", context.userId)
      .single();

    const started = Date.now();
    try {
      const gateway = createLovableAiGatewayProvider(key);
      const model = gateway(data.model || "google/gemini-2.5-flash");
      const result = await generateText({
        model,
        prompt: data.prompt || "Reply with exactly: pong",
      });
      const ms = Date.now() - started;
      const tokens =
        (result.usage?.totalTokens as number | undefined) ??
        (result.usage as any)?.total_tokens ??
        0;

      if (profile?.workspace_id) {
        await context.supabase.from("bot_logs").insert({
          workspace_id: profile.workspace_id,
          bot_name: "gemini",
          level: "info",
          message: "Gemini connection test",
          metadata: { tokens, latency_ms: ms, model: data.model || "google/gemini-2.5-flash" },
        });
      }

      return { ok: true, reply: result.text, tokens, latency_ms: ms };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? "Test failed" };
    }
  });
