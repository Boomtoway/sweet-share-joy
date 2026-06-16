// Lead follow-up tier definitions (server-isomorphic; no env reads).

export type FollowupType = "day_1" | "day_3" | "day_7";

export type FollowupTier = {
  type: FollowupType;
  thresholdMs: number;
  label: string;
  template: (name: string) => string;
};

const TEMPLATES: Record<FollowupType, (name: string) => string> = {
  day_1: (name) =>
    `Hi ${name}, just checking whether you're still interested in our services. Let me know if you have any questions.`,
  day_3: (name) =>
    `Hi ${name}, would you like a free consultation call? I can help explain how our service can grow your business.`,
  day_7: (name) =>
    `Hi ${name}, we currently have a special offer available. Would you like more details?`,
};

export const PROD_FOLLOWUP_TIERS: FollowupTier[] = [
  { type: "day_1", thresholdMs: 1 * 24 * 60 * 60 * 1000, label: "Day 1", template: TEMPLATES.day_1 },
  { type: "day_3", thresholdMs: 3 * 24 * 60 * 60 * 1000, label: "Day 3", template: TEMPLATES.day_3 },
  { type: "day_7", thresholdMs: 7 * 24 * 60 * 60 * 1000, label: "Day 7", template: TEMPLATES.day_7 },
];

// TEST MODE timings — accelerated so the full sequence runs in minutes.
export const TEST_FOLLOWUP_TIERS: FollowupTier[] = [
  { type: "day_1", thresholdMs: 2 * 60 * 1000, label: "Day 1 (test 2m)", template: TEMPLATES.day_1 },
  { type: "day_3", thresholdMs: 5 * 60 * 1000, label: "Day 3 (test 5m)", template: TEMPLATES.day_3 },
  { type: "day_7", thresholdMs: 10 * 60 * 1000, label: "Day 7 (test 10m)", template: TEMPLATES.day_7 },
];

export function tiersFor(testMode: boolean): FollowupTier[] {
  return testMode ? TEST_FOLLOWUP_TIERS : PROD_FOLLOWUP_TIERS;
}

// Backwards-compatible export (defaults to production timings).
export const FOLLOWUP_TIERS = PROD_FOLLOWUP_TIERS;

export function followupMessage(type: FollowupType, name: string): string {
  const tpl = TEMPLATES[type];
  return tpl ? tpl(name || "there") : `Hi ${name || "there"}, following up on our conversation.`;
}
