// Shared VPS sender used by manual replies and AI auto-replies.
// Hits the VPS IP directly so DNS/proxy issues can't break delivery.

export const VPS_SEND_URL = "http://77.37.44.33:3000/send";
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
};

export async function sendViaVps(to: string, message: string): Promise<VpsSendResult> {
  const recipient = normalizeRecipient(to);
  try {
    const res = await fetch(VPS_SEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${VPS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ to: recipient, message }),
    });
    const raw = await res.text();
    let body: any = raw;
    try {
      body = JSON.parse(raw);
    } catch {}
    const ok = res.ok && body?.ok === true;
    return { ok, status: res.status, body, raw };
  } catch (e: any) {
    return { ok: false, status: 0, body: null, raw: "", error: e?.message ?? "fetch failed" };
  }
}
