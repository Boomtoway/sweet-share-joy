import { createFileRoute } from "@tanstack/react-router";

// Public Meta webhook endpoint.
// GET  → handshake verification (Meta sends hub.mode/hub.verify_token/hub.challenge)
// POST → incoming Messenger / Instagram DM events
//
// NOTE: This is a placeholder. Real flow:
//   1. Verify x-hub-signature-256 against the channel's app_secret
//   2. For each entry, route to messenger or instagram handler
//   3. Persist contact + conversation + message
//   4. Run reply rules → Gemini → save assistant reply
//   5. Call Graph API /me/messages with the page access token

export const Route = createFileRoute("/api/public/meta/webhook")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const mode = url.searchParams.get("hub.mode");
        const token = url.searchParams.get("hub.verify_token");
        const challenge = url.searchParams.get("hub.challenge");
        const workspaceId = url.searchParams.get("workspace_id");
        if (!mode || !token || !challenge || !workspaceId) {
          return new Response("Bad Request", { status: 400 });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: channel } = await supabaseAdmin
          .from("channels")
          .select("config")
          .eq("workspace_id", workspaceId)
          .in("type", ["messenger", "instagram"])
          .limit(1)
          .maybeSingle();
        const expected = (channel?.config as any)?.verify_token;
        if (mode === "subscribe" && expected && token === expected) {
          return new Response(challenge, { status: 200 });
        }
        return new Response("Forbidden", { status: 403 });
      },
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const workspaceId = url.searchParams.get("workspace_id");
        const body = await request.text();
        let payload: any = null;
        try {
          payload = JSON.parse(body);
        } catch {
          return new Response("Bad JSON", { status: 400 });
        }
        if (!workspaceId) return new Response("Missing workspace_id", { status: 400 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        await supabaseAdmin.from("bot_logs").insert({
          workspace_id: workspaceId,
          bot_name: "meta-webhook",
          channel: payload?.object === "instagram" ? "instagram" : "messenger",
          level: "info",
          message: `Received webhook event: ${payload?.object ?? "unknown"}`,
          metadata: payload ?? {},
        });

        // TODO: signature verify, parse entry[].messaging[], dispatch to Gemini, send via Graph API.
        return Response.json({ received: true });
      },
    },
  },
});
