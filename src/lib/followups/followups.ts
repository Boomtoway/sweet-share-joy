// Lead follow-up tier definitions (server-isomorphic; no env reads).

export type FollowupType = "day_1" | "day_3" | "day_7";

export const FOLLOWUP_TIERS: {
  type: FollowupType;
  thresholdMs: number;
  label: string;
  template: (name: string) => string;
}[] = [
  {
    type: "day_1",
    thresholdMs: 1 * 24 * 60 * 60 * 1000,
    label: "Day 1",
    template: (name) =>
      `Hi ${name}, just checking whether you're still interested in our services. Let me know if you have any questions.`,
  },
  {
    type: "day_3",
    thresholdMs: 3 * 24 * 60 * 60 * 1000,
    label: "Day 3",
    template: (name) =>
      `Hi ${name}, would you like a free consultation call? I can help explain how our service can grow your business.`,
  },
  {
    type: "day_7",
    thresholdMs: 7 * 24 * 60 * 60 * 1000,
    label: "Day 7",
    template: (name) =>
      `Hi ${name}, we currently have a special offer available. Would you like more details?`,
  },
];

export function followupMessage(type: FollowupType, name: string): string {
  const tier = FOLLOWUP_TIERS.find((t) => t.type === type);
  return tier ? tier.template(name || "there") : `Hi ${name || "there"}, following up on our conversation.`;
}
