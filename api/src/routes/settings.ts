import { Hono } from "hono";
import { SecretProtector } from "../crypto/secretProtector.js";
import { TESTED_COACH_MODEL } from "../llm/coachModel.js";
import { parseAnthropicEffort } from "../llm/effort.js";
import { requireDisclaimer } from "../middleware/requireDisclaimer.js";
import {
  assertPacketHasNoPiiOrGps,
  getLastOutboundPacket,
} from "../packet/index.js";
import {
  deleteAnthropicConnection,
  getAnthropicConnection,
  putAnthropicConnection,
} from "../settings/anthropicStore.js";
import { loadCoachModelCatalogue } from "../settings/coachModelCatalogue.js";
import {
  clearCoachModel,
  getSavedCoachModel,
  saveCoachModel,
} from "../settings/coachModelStore.js";
import type { RuntimeSources } from "../settings/sources.js";
import {
  deleteTempoConnection,
  getTempoConnection,
  putTempoConnection,
} from "../settings/tempoStore.js";

export type SettingsRouteOptions = {
  /** Override wrapping key (tests). Defaults to DATA_PROTECTION_SECRET_KEY. */
  dataProtectionKey?: string;
  /** What the API is running with; an export or the stub needs no saved connection (#6). */
  sources: RuntimeSources;
};

function protectorFrom(options: SettingsRouteOptions): SecretProtector {
  return new SecretProtector(options.dataProtectionKey);
}

/** What Settings shows for Coach Cade's model: the choice, what is in force, and what can be chosen. */
async function coachModelView() {
  const [saved, anthropic] = await Promise.all([
    getSavedCoachModel(),
    getAnthropicConnection(),
  ]);
  const catalogue = await loadCoachModelCatalogue({ saved, hasKey: anthropic.configured });
  return {
    saved,
    effective: saved ?? TESTED_COACH_MODEL,
    tested: TESTED_COACH_MODEL,
    models: catalogue.models,
    fallback: catalogue.fallback,
  };
}

export function createSettingsRoutes(options: SettingsRouteOptions): Hono {
  const { sources } = options;
  const routes = new Hono();

  routes.use("/settings", requireDisclaimer);
  routes.use("/settings/*", requireDisclaimer);

  routes.get("/settings", async (c) => {
    const [tempo, anthropic] = await Promise.all([
      getTempoConnection(),
      getAnthropicConnection(),
    ]);
    return c.json({
      tempo: { ...tempo, source: sources.tempo },
      anthropic: { ...anthropic, source: sources.model },
      demo: sources.demo,
    });
  });

  routes.get("/settings/tempo", async (c) => {
    return c.json(await getTempoConnection());
  });

  routes.put("/settings/tempo", async (c) => {
    let body: { baseUrl?: unknown; apiKey?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() : "";
    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    if (!baseUrl || !apiKey) {
      return c.json({ error: "baseUrl_and_apiKey_required" }, 400);
    }
    try {
      new URL(baseUrl);
    } catch {
      return c.json({ error: "invalid_baseUrl" }, 400);
    }
    try {
      const view = await putTempoConnection(
        baseUrl.replace(/\/+$/, ""),
        apiKey,
        protectorFrom(options),
      );
      return c.json(view);
    } catch (err) {
      const message = err instanceof Error ? err.message : "encrypt_failed";
      return c.json({ error: "encrypt_failed", message }, 500);
    }
  });

  routes.delete("/settings/tempo", async (c) => {
    await deleteTempoConnection();
    return c.json(await getTempoConnection());
  });

  routes.get("/settings/anthropic", async (c) => {
    return c.json(await getAnthropicConnection());
  });

  routes.put("/settings/anthropic", async (c) => {
    let body: { apiKey?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    if (!apiKey) {
      return c.json({ error: "apiKey_required" }, 400);
    }
    try {
      const view = await putAnthropicConnection(apiKey, protectorFrom(options));
      return c.json(view);
    } catch (err) {
      const message = err instanceof Error ? err.message : "encrypt_failed";
      return c.json({ error: "encrypt_failed", message }, 500);
    }
  });

  routes.delete("/settings/anthropic", async (c) => {
    await deleteAnthropicConnection();
    return c.json(await getAnthropicConnection());
  });

  // Writes are accepted in stub and demo modes too: only the page hides the section,
  // and the demo season sets its effort through here.
  routes.get("/settings/coach-model", async (c) => {
    return c.json(await coachModelView());
  });

  routes.put("/settings/coach-model", async (c) => {
    let body: { model?: unknown; effort?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const model = typeof body.model === "string" ? body.model.trim() : "";
    if (!model || typeof body.effort !== "string") {
      return c.json({ error: "model_and_effort_required" }, 400);
    }
    const effort = parseAnthropicEffort(body.effort);
    if (!effort) {
      return c.json({ error: "invalid_effort" }, 400);
    }
    const view = await coachModelView();
    const choice = view.models.find((m) => m.id === model);
    if (!choice) {
      return c.json({ error: "unknown_model" }, 400);
    }
    if (!choice.efforts.includes(effort)) {
      return c.json({ error: "effort_not_supported" }, 400);
    }
    await saveCoachModel({ model, effort });
    return c.json(await coachModelView());
  });

  routes.delete("/settings/coach-model", async (c) => {
    await clearCoachModel();
    return c.json(await coachModelView());
  });

  /**
   * Last redacted outbound model packet (issue #42).
   * Persisted after POST /packet (and future LlmPort sends).
   */
  routes.get("/settings/last-packet", async (c) => {
    const lastPacket = await getLastOutboundPacket();
    if (lastPacket) {
      assertPacketHasNoPiiOrGps(lastPacket.packet, {
        forbiddenSubstrings: ["LineString", "rawGpxData", "rawFitData"],
      });
    }
    return c.json({ lastPacket });
  });

  return routes;
}
