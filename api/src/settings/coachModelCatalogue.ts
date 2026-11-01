import { TESTED_COACH_MODEL, type CoachModel } from "../llm/coachModel.js";
import { ANTHROPIC_EFFORT_LEVELS, type AnthropicEffort } from "../llm/effort.js";

export const TESTED_COACH_MODEL_DISPLAY_NAME = "Claude Opus 4.7";

/** One model the athlete can choose, with the efforts it accepts. */
export type CatalogueModel = {
  id: string;
  displayName: string;
  tested: boolean;
  efforts: AnthropicEffort[];
};

export type Catalogue = {
  models: CatalogueModel[];
  /** Why only the fallback set is offered, or null when the list came from Anthropic. */
  fallback: "no_key" | "unavailable" | null;
};

/**
 * The models the athlete can choose, tested default first. For now always the
 * fallback set: the tested default, plus the saved model at its saved effort.
 * Listing the models the key can use comes next (issue #52, ticket 03).
 */
export async function loadCoachModelCatalogue(options: {
  saved: CoachModel | null;
  hasKey: boolean;
}): Promise<Catalogue> {
  const { saved, hasKey } = options;
  const models: CatalogueModel[] = [
    {
      id: TESTED_COACH_MODEL.model,
      displayName: TESTED_COACH_MODEL_DISPLAY_NAME,
      tested: true,
      efforts: [...ANTHROPIC_EFFORT_LEVELS],
    },
  ];
  if (saved && saved.model !== TESTED_COACH_MODEL.model) {
    models.push({ id: saved.model, displayName: saved.model, tested: false, efforts: [saved.effort] });
  }
  return { models, fallback: hasKey ? "unavailable" : "no_key" };
}
