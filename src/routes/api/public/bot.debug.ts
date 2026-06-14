import { createFileRoute } from "@tanstack/react-router";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

export const Route = createFileRoute("/api/public/bot/debug")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        }),
      GET: async () => {
        const result = {
          webhook: true,
          gemini: false,
          database: false,
          vps: false as boolean | string,
          timings_ms: {} as Record<string, number>,
        };

        // gemini: API key present
        result.gemini = !!process.env.GEMINI_API_KEY;

        // database ping
        const t0 = Date.now();
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { error } = await supabaseAdmin
            .from("whatsapp_sessions")
            .select("id")
            .limit(1);
          result.database = !error;
          result.timings_ms.database = Date.now() - t0;
        } catch {
          result.timings_ms.database = Date.now() - t0;
        }

        // vps: at least one session has endpoint+token configured and reachable
        const t1 = Date.now();
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: sess } = await supabaseAdmin
            .from("whatsapp_sessions")
            .select("vps_endpoint, vps_api_token")
            .not("vps_endpoint", "is", null)
            .limit(1)
            .maybeSingle();
          if (sess?.vps_endpoint && sess.vps_api_token) {
            const url = sess.vps_endpoint.replace(/\/$/, "") + "/status";
            const ctl = AbortSignal.timeout(3000);
            const res = await fetch(url, {
              headers: { Authorization: `Bearer ${sess.vps_api_token}` },
              signal: ctl,
            });
            result.vps = res.ok ? true : `HTTP ${res.status}`;
          } else {
            result.vps = "not_configured";
          }
          result.timings_ms.vps = Date.now() - t1;
        } catch (e: any) {
          result.vps = `error: ${e?.message ?? "unknown"}`;
          result.timings_ms.vps = Date.now() - t1;
        }

        return new Response(JSON.stringify(result, null, 2), { headers: cors });
      },
    },
  },
});
