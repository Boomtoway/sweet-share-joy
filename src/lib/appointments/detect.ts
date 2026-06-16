// Lightweight appointment intent + datetime extractor used by the webhook.
// Returns null when no booking intent is detected.

const INTENT_PATTERNS = [
  /book(\s+a)?\s+(call|meeting|appointment|demo|slot)/i,
  /schedule\s+(a\s+)?(call|meeting|appointment|demo)/i,
  /can\s+we\s+(talk|meet|call|chat)/i,
  /let'?s\s+(talk|meet|call|chat)/i,
  /set\s+up\s+(a\s+)?(call|meeting)/i,
  /\bappointment\b/i,
  /\bmeeting\b/i,
  /\bdemo\b/i,
];

const TIME_RE = /\b(0?[1-9]|1[0-2])[.:]([0-5]\d)\s*(am|pm)?\b|\b([01]?\d|2[0-3])[.:]([0-5]\d)\b/i;
const HOUR_ONLY_RE = /\b(0?[1-9]|1[0-2])\s*(am|pm)\b/i;

function nextDow(from: Date, targetDow: number): Date {
  const d = new Date(from);
  const diff = (targetDow + 7 - d.getDay()) % 7 || 7;
  d.setDate(d.getDate() + diff);
  return d;
}

function parseDate(text: string, now: Date): Date | null {
  const t = text.toLowerCase();
  if (/\btoday\b/.test(t)) return new Date(now);
  if (/\btomorrow\b|\btmrw\b|\btmr\b/.test(t)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return d;
  }
  if (/\bday\s+after\s+tomorrow\b/.test(t)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 2);
    return d;
  }
  const dows = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  for (let i = 0; i < 7; i++) {
    const re = new RegExp(`\\b(next\\s+)?${dows[i]}\\b`, "i");
    if (re.test(t)) return nextDow(now, i);
  }
  // dd/mm or dd-mm
  const m = t.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
  if (m) {
    const day = +m[1];
    const month = +m[2] - 1;
    const year = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : now.getFullYear();
    const d = new Date(year, month, day);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

function parseTime(text: string): { h: number; m: number } | null {
  const m = text.match(TIME_RE);
  if (m) {
    let h: number;
    let min: number;
    let ap: string | undefined;
    if (m[1]) {
      h = +m[1];
      min = +m[2];
      ap = m[3]?.toLowerCase();
    } else {
      h = +m[4];
      min = +m[5];
    }
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    return { h, m: min };
  }
  const h = text.match(HOUR_ONLY_RE);
  if (h) {
    let hh = +h[1];
    const ap = h[2].toLowerCase();
    if (ap === "pm" && hh < 12) hh += 12;
    if (ap === "am" && hh === 12) hh = 0;
    return { h: hh, m: 0 };
  }
  return null;
}

export interface DetectedAppointment {
  intent: boolean;
  date: string | null; // YYYY-MM-DD
  time: string | null; // HH:MM:00
  datetime: string | null; // ISO
  service_needed: string | null;
}

export function detectAppointment(message: string, now: Date = new Date()): DetectedAppointment | null {
  if (!message) return null;
  const hasIntent = INTENT_PATTERNS.some((re) => re.test(message));
  const date = parseDate(message, now);
  const time = parseTime(message);
  // Require either explicit intent keyword OR (date + time both present).
  if (!hasIntent && !(date && time)) return null;

  let appointmentDate: Date | null = date;
  if (!appointmentDate && time) {
    // assume today if time only, but if time already passed, push to tomorrow
    appointmentDate = new Date(now);
    if (time.h < now.getHours() || (time.h === now.getHours() && time.m <= now.getMinutes())) {
      appointmentDate.setDate(appointmentDate.getDate() + 1);
    }
  }

  let dt: Date | null = null;
  if (appointmentDate && time) {
    dt = new Date(appointmentDate);
    dt.setHours(time.h, time.m, 0, 0);
  } else if (appointmentDate) {
    dt = new Date(appointmentDate);
    dt.setHours(10, 0, 0, 0);
  }

  const pad = (n: number) => String(n).padStart(2, "0");
  const dateStr = appointmentDate
    ? `${appointmentDate.getFullYear()}-${pad(appointmentDate.getMonth() + 1)}-${pad(appointmentDate.getDate())}`
    : null;
  const timeStr = time ? `${pad(time.h)}:${pad(time.m)}:00` : null;

  // crude service extraction
  let service: string | null = null;
  const svc = message.match(/\b(demo|consultation|call|meeting|appointment|chat)\b/i);
  if (svc) service = svc[1].toLowerCase();

  return {
    intent: true,
    date: dateStr,
    time: timeStr,
    datetime: dt ? dt.toISOString() : null,
    service_needed: service,
  };
}
