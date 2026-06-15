// Shared VPS sender used by manual replies and AI auto-replies.
// Hits the VPS IP directly so DNS/proxy issues can't break delivery.

export const VPS_SEND_URL = "https://bot.statapplkmarketing.shop/send";
export const VPS_TOKEN = "startapplk-bot-12345";

/** Normalize WhatsApp recipient: strip JID suffix, keep digits, leading 0 -> 94. */
export function normalizeRecipient(value: unknown): string {
  let v = String(value ?? "").trim();
  v = v.replace("@s.whatsapp.net", "");
  let digits = v.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = `94${digits.slice(1)}`;
  return digits;
}

/** Pick recipient: conversation.remote_jid || contact.remote_jid || contact.phone */
export function pickRecipient(conversation: any, contact: any): string {
  const raw = conversation?.remote_jid || contact?.remote_jid || contact?.phone || "";
  return normalizeRecipient(raw);
}

export type VpsSendResult = {
  ok: boolean;
  status: number;
  body: any;
  raw: string;
  error?: string;
  request: {
    url: string;
    headers: Record<string, string>;
    body: string;
    recipient: string;
  };
};

export function getVpsResponseText(result: VpsSendResult): string {
  return result.raw || result.error || (typeof result.body === "string" ? result.body : JSON.stringify(result.body ?? ""));
}

export async function sendViaVps(to: string, message: string): Promise<VpsSendResult> {
  const recipient = normalizeRecipient(to);
  const authHeader = `Bearer ${VPS_TOKEN}`;
  const requestHeaders = { Authorization: authHeader, "Content-Type": "application/json" };
  const requestBody = JSON.stringify({ to: recipient, message });
  const requestDebug = { url: VPS_SEND_URL, headers: requestHeaders, body: requestBody, recipient };
  console.log("VPS_URL", VPS_SEND_URL);
  console.log("REQUEST_HEADERS", requestHeaders);
  console.log("REQUEST_BODY", requestBody);
  try {
    const res = await fetch(VPS_SEND_URL, {
      method: "POST",
      headers: requestHeaders,
      body: requestBody,
    });
    const raw = await res.text();
    let body: any = raw;
    try { body = JSON.parse(raw); } catch {}
    console.log("RESPONSE_STATUS", res.status);
    console.log("RESPONSE_BODY", raw);
    const ok = res.ok && body?.ok === true;
    return { ok, status: res.status, body, raw, request: requestDebug };
  } catch (e: any) {
    const messageText = e?.message ?? "fetch failed";
    console.log("RESPONSE_STATUS", 0);
    console.log("RESPONSE_BODY", messageText);
    console.error("VPS_ERROR", e);
    return { ok: false, status: 0, body: null, raw: messageText, error: messageText, request: requestDebug };
  }
}
