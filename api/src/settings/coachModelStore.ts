import { pool } from "../db.js";
import type { CoachModel } from "../llm/coachModel.js";
import { parseAnthropicEffort } from "../llm/effort.js";

/** The model and effort the athlete saved, or null when they never chose (or reset). */
export async function getSavedCoachModel(): Promise<CoachModel | null> {
  const result = await pool.query<{ model: string; effort: string }>(
    "SELECT model, effort FROM coach_model_settings WHERE id = 1",
  );
  const row = result.rows[0];
  if (!row) return null;
  const effort = parseAnthropicEffort(row.effort);
  return effort ? { model: row.model, effort } : null;
}

export async function saveCoachModel(choice: CoachModel): Promise<void> {
  await pool.query(
    `
    INSERT INTO coach_model_settings (id, model, effort, updated_at)
    VALUES (1, $1, $2, NOW())
    ON CONFLICT (id) DO UPDATE
      SET model = EXCLUDED.model, effort = EXCLUDED.effort, updated_at = NOW()
    `,
    [choice.model, choice.effort],
  );
}

/** Back to the tested default. */
export async function clearCoachModel(): Promise<void> {
  await pool.query("DELETE FROM coach_model_settings WHERE id = 1");
}
