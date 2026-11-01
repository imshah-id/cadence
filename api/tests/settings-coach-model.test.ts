import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { FixedClock } from "../src/clock/clock.js";
import { SecretProtector } from "../src/crypto/secretProtector.js";
import { pool } from "../src/db.js";
import {
  buildStubWeeklyReply,
  createAnthropicLlmPort,
  TESTED_COACH_MODEL,
} from "../src/llm/index.js";
import { migrate } from "../src/migrate.js";
import { buildModelPacket, type ModelPacket } from "../src/packet/index.js";
import { putAnthropicConnection } from "../src/settings/anthropicStore.js";
import { saveCoachModel } from "../src/settings/coachModelStore.js";
import type { RuntimeSources } from "../src/settings/sources.js";
import {
  acceptAndReady,
  anthropicStreamResponse,
  anthropicToolMessage,
  json,
  resetAppTables,
  TEST_DATA_PROTECTION_KEY,
  unlockPlanCheckIn,
} from "./helpers.js";

const API_KEY = "sk-ant-test-key-coach-model";
const ALL_EFFORTS = ["low", "medium", "high", "xhigh", "max"];

function samplePacket(): ModelPacket {
  return buildModelPacket({
    dossier: { versionId: 1, body: "Keep Achilles easy; cap quality." },
    recapMarkdown: "## Summary\nSteady aerobic week.",
    thread: [],
    attachments: [],
    week: {
      isoWeek: "2026-W43",
      start: "2026-10-19T00:00:00.000Z",
      end: "2026-10-25T23:59:59.999Z",
      weekSessionId: "00000000-0000-4000-8000-000000000001",
    },
  });
}

function settingsApp(sources?: RuntimeSources) {
  return createApp({ dataProtectionKey: TEST_DATA_PROTECTION_KEY, sources });
}

function put(app: ReturnType<typeof createApp>, body: unknown) {
  return app.request("/settings/coach-model", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function savedRows() {
  const result = await pool.query("SELECT model, effort FROM coach_model_settings");
  return result.rows;
}

describe("coach model setting", () => {
  beforeAll(async () => {
    process.env.DATA_PROTECTION_SECRET_KEY = TEST_DATA_PROTECTION_KEY;
    await migrate();
  });

  beforeEach(async () => {
    await resetAppTables();
  });

  it("with nothing saved, offers the tested default at every effort and says why the list is short", async () => {
    await acceptAndReady();
    const app = settingsApp();

    const view = await json(await app.request("/settings/coach-model"));
    expect(view.saved).toBeNull();
    expect(view.effective).toEqual(TESTED_COACH_MODEL);
    expect(view.tested).toEqual(TESTED_COACH_MODEL);
    expect(view.models).toEqual([
      { id: "claude-opus-4-7", displayName: "Claude Opus 4.7", tested: true, efforts: ALL_EFFORTS },
    ]);
    expect(view.fallback).toBe("no_key");

    await putAnthropicConnection(API_KEY, new SecretProtector(TEST_DATA_PROTECTION_KEY));
    expect((await json(await app.request("/settings/coach-model"))).fallback).toBe("unavailable");
  });

  it("saves a supported effort, and DELETE goes back to the tested default", async () => {
    await acceptAndReady();
    const app = settingsApp();

    const saved = await put(app, { model: "claude-opus-4-7", effort: "Medium" });
    expect(saved.status).toBe(200);
    const view = await json(saved);
    expect(view.saved).toEqual({ model: "claude-opus-4-7", effort: "medium" });
    expect(view.effective).toEqual({ model: "claude-opus-4-7", effort: "medium" });
    expect(await savedRows()).toEqual([{ model: "claude-opus-4-7", effort: "medium" }]);

    const cleared = await json(await app.request("/settings/coach-model", { method: "DELETE" }));
    expect(cleared.saved).toBeNull();
    expect(cleared.effective).toEqual(TESTED_COACH_MODEL);
    expect(await savedRows()).toEqual([]);
  });

  it("refuses what it cannot check, and saves nothing", async () => {
    await acceptAndReady();
    const app = settingsApp();

    for (const [body, error] of [
      [{ model: "claude-haiku-4-5", effort: "high" }, "unknown_model"],
      [{ model: "claude-opus-4-7", effort: "extra" }, "invalid_effort"],
      [{ model: "claude-opus-4-7" }, "model_and_effort_required"],
      [{ effort: "high" }, "model_and_effort_required"],
      ["{not json", "invalid_json"],
    ] as const) {
      const res = await put(app, body);
      expect(res.status).toBe(400);
      expect((await json(res)).error).toBe(error);
    }
    expect(await savedRows()).toEqual([]);
  });

  it("is behind the disclaimer", async () => {
    const res = await settingsApp().request("/settings/coach-model");
    expect(res.status).toBe(403);
  });

  it("accepts writes in stub and demo modes, so the demo season can set its effort", async () => {
    await acceptAndReady();
    const app = settingsApp({ tempo: "export", model: "stub", demo: true });
    const res = await put(app, { model: "claude-opus-4-7", effort: "medium" });
    expect(res.status).toBe(200);
    expect(await savedRows()).toEqual([{ model: "claude-opus-4-7", effort: "medium" }]);
  });
});

describe("coach calls follow the saved setting", () => {
  beforeAll(async () => {
    process.env.DATA_PROTECTION_SECRET_KEY = TEST_DATA_PROTECTION_KEY;
    await migrate();
  });

  beforeEach(async () => {
    await resetAppTables();
  });

  type SentBody = { model: string; output_config: { effort: string } };

  async function liveApp(respond: (attempt: number) => Promise<Response>) {
    await acceptAndReady();
    const sent: SentBody[] = [];
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)) as SentBody);
      return respond(sent.length);
    }) as unknown as typeof globalThis.fetch;
    const app = createApp({
      dataProtectionKey: TEST_DATA_PROTECTION_KEY,
      clock: new FixedClock(new Date("2026-10-21T15:00:00.000Z")),
      llmPort: createAnthropicLlmPort({ fetchImpl, readApiKey: async () => API_KEY }),
    });
    const week = await json(await app.request("/weeks/current", { method: "POST" }));
    const weekSessionId = week.id as string;
    await unlockPlanCheckIn(app, weekSessionId);
    return { app, weekSessionId, sent };
  }

  function askForReply(app: ReturnType<typeof createApp>, weekSessionId: string) {
    return app.request("/week/reply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ weekSessionId, packet: samplePacket() }),
    });
  }

  const goodReply = () =>
    anthropicStreamResponse(
      anthropicToolMessage("submit_weekly_reply", buildStubWeeklyReply(samplePacket())),
    );

  it("the next call sends the saved effort and logs it, with no restart", async () => {
    const { app, weekSessionId, sent } = await liveApp(async () => goodReply());
    expect((await put(app, { model: "claude-opus-4-7", effort: "medium" })).status).toBe(200);

    expect((await askForReply(app, weekSessionId)).status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ model: "claude-opus-4-7", output_config: { effort: "medium" } });

    const list = (await json(await app.request("/llm-calls"))) as unknown as Array<{ id: string }>;
    const row = await json(await app.request(`/llm-calls/${list[0]!.id}`));
    expect(row.model).toBe("claude-opus-4-7");
    expect(row.request).toMatchObject({ output_config: { effort: "medium" } });
  });

  it("a reply asked once more keeps the pair it started with, even if Settings changes in between", async () => {
    const { app, weekSessionId, sent } = await liveApp(async (attempt) => {
      if (attempt > 1) return goodReply();
      // The athlete changes Settings while the first attempt is out; it comes back refused for its shape.
      await saveCoachModel({ model: "claude-opus-4-7", effort: "low" });
      return anthropicStreamResponse(
        anthropicToolMessage("submit_weekly_reply", { headline: "", prescribedWeek: null }),
      );
    });
    await put(app, { model: "claude-opus-4-7", effort: "medium" });

    expect((await askForReply(app, weekSessionId)).status).toBe(200);
    expect(sent).toHaveLength(2);
    for (const body of sent) {
      expect(body).toMatchObject({ model: "claude-opus-4-7", output_config: { effort: "medium" } });
    }
  });
});
