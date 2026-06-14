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
        const result: any = {
          webhook: true,
          gemini: false,
          database: false,
          vps: false as boolean | string,
          timings_ms: {} as Record<string, number>,
          last_webhook: null,
          last_ai_response: null,
          last_vps_send: null,
          last_vps_error: null,
          recent_outbound: [] as any[],
        };

        result.gemini = !!process.env.GEMINI_API_KEY;

        const t0 = Date.now();
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { error } = await supabaseAdmin
            .from("whatsapp_sessions")
            .select("id")
            .limit(1);
          result.database = !error;
          result.timings_ms.database = Date.now() - t0;

          const pickLast = async (msg: string) => {
            const { data } = await supabaseAdmin
              .from("bot_logs")
              .select("created_at, level, message, metadata")
              .eq("message", msg)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            return data ?? null;
          };
          result.last_webhook = await pickLast("inbound_received");
          result.last_ai_response = await pickLast("ai_completed");
          result.last_vps_send = await pickLast("vps_send_response");
          result.last_vps_error = await pickLast("vps_send_error");

          const { data: recent } = await supabaseAdmin
            .from("messages")
            .select("id, direction, delivery_status, delivery_error, target_jid, provider_message_id, created_at, delivered_at")
            .eq("direction", "outbound")
            .order("created_at", { ascending: false })
            .limit(5);
          result.recent_outbound = recent ?? [];
        } catch {
          result.timings_ms.database = Date.now() - t0;
        }

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
            const res = await fetch(url, {
              headers: { Authorization: `Bearer ${sess.vps_api_token}` },
              signal: AbortSignal.timeout(3000),
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
