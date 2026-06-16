// Shared reminder helpers (server-only logic, isomorphic-safe — no env reads).

export type ReminderTier = "24h" | "1h" | "15m";

export const REMINDER_TIERS: { tier: ReminderTier; offsetMs: number; flag: string; logCode: string }[] = [
  { tier: "24h", offsetMs: 24 * 60 * 60 * 1000, flag: "reminder_24h_sent", logCode: "REMINDER_24H_SENT" },
  { tier: "1h", offsetMs: 60 * 60 * 1000, flag: "reminder_1h_sent", logCode: "REMINDER_1H_SENT" },
  { tier: "15m", offsetMs: 15 * 60 * 1000, flag: "reminder_15m_sent", logCode: "REMINDER_15M_SENT" },
];

export function formatApptTime(dt: Date): string {
  return dt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function reminderMessage(tier: ReminderTier, name: string, dt: Date): string {
  const time = formatApptTime(dt);
  if (tier === "24h") return `Hi ${name}, this is a reminder that your appointment is tomorrow at ${time}.`;
  if (tier === "1h") return `Hi ${name}, your appointment starts in 1 hour.`;
  return `Hi ${name}, your appointment starts in 15 minutes. Please be ready.`;
}
