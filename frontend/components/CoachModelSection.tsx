"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button, cx, ErrorNote, Field, Muted, SectionTitle, Select } from "@/components/ui";
import {
  fetchCoachModel,
  resetCoachModel,
  saveCoachModel,
  type CoachEffort,
  type CoachModelSettings,
} from "@/lib/api";
import { describeError, type UiError } from "@/lib/errors";

const EFFORTS: { value: CoachEffort; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra high" },
  { value: "max", label: "Max" },
];

const effortLabel = (effort: CoachEffort) => EFFORTS.find((e) => e.value === effort)!.label;

/**
 * The level a model falls back to when it can't take the one chosen: the nearest
 * level below it, else the lowest it has. Never silently more costly.
 */
function nearestEffort(wanted: CoachEffort, supported: CoachEffort[]): CoachEffort {
  const order = EFFORTS.map((e) => e.value);
  const below = order.slice(0, order.indexOf(wanted)).reverse().find((e) => supported.includes(e));
  return below ?? order.find((e) => supported.includes(e)) ?? wanted;
}

/**
 * Coach Cade's model and thinking level (#52). Shown only with the live coach: in demo
 * mode and with the offline coach there is nothing to choose.
 */
export function CoachModelSection({ offline, demo }: { offline: boolean; demo: boolean }) {
  const [settings, setSettings] = useState<CoachModelSettings | null>(null);
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState<CoachEffort>("xhigh");
  const [adjusted, setAdjusted] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<UiError | null>(null);
  const [busy, setBusy] = useState(false);

  function show(next: CoachModelSettings) {
    setSettings(next);
    setModel(next.effective.model);
    setEffort(next.effective.effort);
    setAdjusted(null);
  }

  useEffect(() => {
    if (offline) return;
    let cancelled = false;
    fetchCoachModel()
      .then((next) => {
        if (!cancelled) show(next);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(describeError(err, "Couldn’t load Coach Cade’s model. Try again."));
      });
    return () => {
      cancelled = true;
    };
  }, [offline]);

  if (offline) {
    return (
      <section className="flex flex-col gap-3" aria-label="Coach model">
        <SectionTitle>Coach model</SectionTitle>
        <Muted>
          {demo
            ? "This demo uses the offline coach, so there is no model to choose."
            : "In use: the offline coach, so there is no model to choose. To use Claude, set LLM_PROVIDER=anthropic and restart."}
        </Muted>
      </section>
    );
  }

  const models = settings?.models ?? [];
  const selected = models.find((m) => m.id === model);
  const supported = selected?.efforts ?? [];
  const nameOf = (id: string) => models.find((m) => m.id === id)?.displayName ?? id;
  const unchanged =
    settings != null && model === settings.effective.model && effort === settings.effective.effort;

  function chooseModel(id: string) {
    setModel(id);
    setStatus(null);
    const next = models.find((m) => m.id === id);
    if (next && !next.efforts.includes(effort)) {
      const fallback = nearestEffort(effort, next.efforts);
      setAdjusted(
        `${next.displayName} can’t think at ${effortLabel(effort)}, so this is set to ${effortLabel(fallback)}.`,
      );
      setEffort(fallback);
    } else {
      setAdjusted(null);
    }
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const next = await saveCoachModel({ model, effort });
      show(next);
      setStatus(
        `Saved. Coach Cade uses ${nameOf(next.effective.model)} at ${effortLabel(next.effective.effort)} from the next reply.`,
      );
    } catch (err) {
      // Keep the athlete's selection so they can change it and try again.
      setError(describeError(err, "Couldn’t save that. Try again."));
    } finally {
      setBusy(false);
    }
  }

  async function onReset() {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      show(await resetCoachModel());
      setStatus("Back to the tested default.");
    } catch (err) {
      setError(describeError(err, "Couldn’t reset that. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3" aria-label="Coach model">
      <SectionTitle>Coach model</SectionTitle>
      {settings ? (
        <form onSubmit={(e) => void onSave(e)} className="flex flex-col gap-3">
          <Muted>
            Cadence was built and tested on {nameOf(settings.tested.model)} at{" "}
            {effortLabel(settings.tested.effort)}. Other choices work, but Coach Cade may coach
            differently, follow its instructions less closely, and fail to reply more often.
          </Muted>
          <Field label="Model">
            <Select value={model} onChange={(e) => chooseModel(e.target.value)} disabled={busy}>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.tested ? `${m.displayName} · tested` : m.displayName}
                </option>
              ))}
            </Select>
          </Field>
          {settings.fallback ? (
            <Muted>
              {settings.fallback === "no_key"
                ? "Save your Anthropic key to see other models."
                : "Couldn’t load the models your key can use, so only these are shown. Try again later."}
            </Muted>
          ) : null}
          <div role="radiogroup" aria-label="Thinking level" className="flex flex-wrap gap-2">
            {EFFORTS.map((choice) => {
              const available = supported.includes(choice.value);
              const checked = effort === choice.value;
              return (
                <button
                  key={choice.value}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  disabled={!available || busy}
                  onClick={() => {
                    setEffort(choice.value);
                    setAdjusted(null);
                    setStatus(null);
                  }}
                  className={cx(
                    "rounded-tempo border px-4 py-2.5 text-base font-semibold",
                    checked ? "border-ink bg-raised text-ink" : "border-border text-muted hover:text-ink",
                    !available && "cursor-not-allowed opacity-40 hover:text-muted",
                  )}
                >
                  {choice.label}
                </button>
              );
            })}
          </div>
          {adjusted ? <p className="m-0">{adjusted}</p> : null}
          <Muted>
            Higher levels think longer, so replies are slower and cost more. Max can take several
            minutes.
          </Muted>
          <div className="flex flex-wrap gap-3">
            <Button type="submit" variant="primary" disabled={busy || unchanged}>
              Save model
            </Button>
            {settings.saved ? (
              <Button variant="quiet" disabled={busy} onClick={() => void onReset()}>
                Reset to tested default
              </Button>
            ) : null}
          </div>
          {status ? <p className="m-0 text-ok">{status}</p> : null}
        </form>
      ) : error ? null : (
        <Muted>Loading…</Muted>
      )}
      <ErrorNote error={error} />
    </section>
  );
}
