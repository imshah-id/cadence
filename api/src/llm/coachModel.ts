import type { AnthropicEffort } from "./effort.js";

/** The model and thinking effort one coach call is sent with. */
export type CoachModel = { model: string; effort: AnthropicEffort };

/**
 * The pair Cadence was built and dogfooded on (ADR 0004). The prompts, tool
 * schemas, length caps and call timeout were tuned against it.
 */
export const TESTED_COACH_MODEL: CoachModel = {
  model: "claude-opus-4-7",
  effort: "xhigh",
};

/**
 * The pair the next coach call uses. Read per call, like the API key, so a
 * change applies without a restart. Only the tested default for now; the
 * athlete's saved setting comes next (issue #52).
 */
export async function resolveCoachModel(): Promise<CoachModel> {
  return TESTED_COACH_MODEL;
}
