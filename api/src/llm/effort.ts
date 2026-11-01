export const ANTHROPIC_EFFORT_LEVELS = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type AnthropicEffort = (typeof ANTHROPIC_EFFORT_LEVELS)[number];

/**
 * Read a thinking effort level, ignoring case and surrounding space. Anything
 * that is not one of the five levels returns null.
 */
export function parseAnthropicEffort(raw: string): AnthropicEffort | null {
  const value = raw.trim().toLowerCase();
  return (ANTHROPIC_EFFORT_LEVELS as readonly string[]).includes(value)
    ? (value as AnthropicEffort)
    : null;
}
