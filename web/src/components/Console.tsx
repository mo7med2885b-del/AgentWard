"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { PaperPlaneRight, Sparkle, Plus, ListChecks, FlowArrow } from "@phosphor-icons/react";
import type {
  ActionItem,
  AgentId,
  CascadeEvent,
  CascadeStep,
  Investigation,
  TriageData,
  Vital,
} from "@/lib/types";
import { PIPELINE, SAMPLE_CASE } from "@/lib/agent-ui";
import {
  detectAllergyConflict,
  parseActions,
  parseInvestigations,
  parseTriage,
  parseVitals,
} from "@/lib/parsers";
import { PipelineRail, type StageState } from "./PipelineRail";
import { TriagePanel } from "./dashboard/TriagePanel";
import { CarePlanPanel } from "./dashboard/CarePlanPanel";
import { EhrPanel } from "./dashboard/EhrPanel";
import { HitlOverlay, type HitlDecision } from "./dashboard/HitlOverlay";
import { SafetyAlert, CorrectionBanner } from "./dashboard/Alerts";
import { AgentRawCard } from "./AgentMessage";

const idleStates = (): Record<AgentId, StageState> =>
  PIPELINE.reduce((acc, id) => ({ ...acc, [id]: "idle" }), {} as Record<AgentId, StageState>);

// Raw agent outputs accumulated during a run, keyed by agent.
type Outputs = Partial<Record<AgentId, { content: string; bandSynced: boolean }>>;

export function Console() {
  const [outputs, setOutputs] = useState<Outputs>({});
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [states, setStates] = useState<Record<AgentId, StageState>>(idleStates());
  const [running, setRunning] = useState(false);
  const [statusLine, setStatusLine] = useState("");
  const [error, setError] = useState("");
  const [input, setInput] = useState("");
  const [newRoom, setNewRoom] = useState(true);
  const [roomId, setRoomId] = useState("");
  const [caseText, setCaseText] = useState("");

  // HITL / safety / correction transient UI state.
  const [paused, setPaused] = useState(false);
  const [runId, setRunId] = useState("");
  const [safety, setSafety] = useState("");
  const [correcting, setCorrecting] = useState("");

  const startedRef = useRef(false);

  // ── Derived dashboard data (parsed from raw agent outputs) ──
  const triage: TriageData | null = useMemo(
    () => parseTriage(outputs.triage?.content ?? ""),
    [outputs.triage]
  );
  const vitals: Vital[] = useMemo(() => parseVitals(caseText), [caseText]);
  const investigations: Investigation[] = useMemo(
    () => parseInvestigations(outputs.investigation?.content ?? ""),
    [outputs.investigation]
  );
  const note = outputs.documentation?.content ?? "";

  // Consume the SSE stream from a fetch Response body.
  const consume = useCallback(async (res: Response) => {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith("data:")) continue;
        handleEvent(JSON.parse(line.slice(5).trim()) as CascadeEvent);
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleEvent = useCallback((ev: CascadeEvent) => {
    if (ev.runId) setRunId(ev.runId);

    if (ev.type === "status") {
      if (ev.message) {
        const m = ev.message.match(/New Band room ready:\s*([0-9a-f-]{8,})/i);
        if (m) setRoomId(m[1]);
      }
      if (ev.agent) setStates((s) => ({ ...s, [ev.agent as AgentId]: "active" }));
      setStatusLine(ev.message ?? "");
    } else if (ev.type === "step" && ev.step) {
      const step = ev.step as CascadeStep;
      setStates((s) => ({ ...s, [step.agent]: "done" }));
      setOutputs((o) => ({
        ...o,
        [step.agent]: { content: step.content, bandSynced: step.bandSynced },
      }));
      // Management output drives the actions checklist + allergy safety check.
      if (step.agent === "management") {
        setActions(parseActions(step.content));
      }
    } else if (ev.type === "pause") {
      setPaused(true);
      setStatusLine("Paused for clinical verification…");
    } else if (ev.type === "correcting") {
      setCorrecting(ev.message ?? "Observer flagged an issue — regenerating plan…");
      if (ev.agent) setStates((s) => ({ ...s, [ev.agent as AgentId]: "active" }));
    } else if (ev.type === "safety_alert") {
      setSafety(ev.message ?? "Potential medication contraindication detected.");
    } else if (ev.type === "error") {
      setError(ev.message ?? "Unknown error");
    } else if (ev.type === "done") {
      setStatusLine("");
      setCorrecting("");
    }
  }, []);

  const run = useCallback(
    async (text: string) => {
      if (running || !text.trim()) return;
      setRunning(true);
      setError("");
      setSafety("");
      setCorrecting("");
      setPaused(false);
      setStates(idleStates());
      setOutputs({});
      setActions([]);
      setRoomId("");
      setRunId("");
      setCaseText(text);
      startedRef.current = true;
      setStatusLine("Connecting to the agent board…");

      try {
        const res = await fetch("/api/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ case: text, newRoom }),
        });
        if (!res.ok || !res.body) throw new Error(`Server error ${res.status}`);
        await consume(res);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setRunning(false);
        setStatusLine("");
      }
    },
    [running, newRoom, consume]
  );

  // Resolve the HITL checkpoint: resume the pipeline stream.
  const resolveHitl = useCallback(
    async (d: HitlDecision) => {
      setPaused(false);
      setStatusLine("Resuming pipeline…");

      // Apply an ATS override locally for instant dashboard feedback.
      if (d.atsOverride && outputs.triage) {
        setOutputs((o) => ({
          ...o,
          triage: {
            ...o.triage!,
            content: o.triage!.content.replace(/ATS\s*\[?\s*[1-5]/i, `ATS ${d.atsOverride}`),
          },
        }));
      }

      try {
        const res = await fetch("/api/run/resume", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            runId,
            approved: d.approved,
            atsOverride: d.atsOverride,
            note: d.note,
          }),
        });
        if (res.ok && res.body) await consume(res);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setRunning(false);
        setStatusLine("");
      }
    },
    [runId, outputs.triage, consume]
  );

  const toggleAction = useCallback((id: string) => {
    setActions((a) => a.map((x) => (x.id === id ? { ...x, completed: !x.completed } : x)));
  }, []);

  const syncToRoom = useCallback(() => {
    setStatusLine("Note re-synced to Band room.");
    setTimeout(() => setStatusLine(""), 1800);
  }, []);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    run(input);
  };

  const idle = !startedRef.current;

  return (
    <div className="space-y-5">
      {/* HITL overlay */}
      <AnimatePresence>
        {paused && <HitlOverlay currentAts={triage?.atsLevel ?? null} onResolve={resolveHitl} />}
      </AnimatePresence>

      {/* Case composer + controls */}
      <form onSubmit={onSubmit}>
        <div className="flex flex-col gap-2 rounded-3xl border border-navy/20 bg-cream-soft p-3 md:flex-row md:items-end">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                run(input);
              }
            }}
            rows={2}
            placeholder="Describe the patient: age, complaint, vitals, allergies…"
            disabled={running}
            className="max-h-40 flex-1 resize-none bg-transparent px-3 py-2 text-[0.95rem] text-navy placeholder:text-navy/35 focus:outline-none disabled:opacity-60"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setInput(SAMPLE_CASE);
                run(SAMPLE_CASE);
              }}
              disabled={running}
              className="flex items-center justify-center gap-2 rounded-2xl border border-navy/20 bg-cream-soft px-4 py-2.5 text-sm font-medium text-navy transition active:translate-y-[1px] disabled:opacity-50"
            >
              <Sparkle size={15} weight="fill" />
              Sample case
            </button>
            <button
              type="submit"
              disabled={running || !input.trim()}
              className="flex items-center justify-center gap-2 rounded-2xl bg-navy px-5 py-2.5 text-sm font-medium text-cream transition active:scale-[0.98] disabled:opacity-40"
            >
              <PaperPlaneRight size={16} weight="fill" />
              Run board
            </button>
          </div>
        </div>
        <div className="mt-2 flex items-center gap-3 px-1">
          <button
            type="button"
            onClick={() => setNewRoom((v) => !v)}
            disabled={running}
            className="flex items-center gap-2 text-xs font-medium text-navy/60 disabled:opacity-50"
            aria-pressed={newRoom}
          >
            <span
              className="relative h-4 w-7 rounded-full transition-colors"
              style={{ background: newRoom ? "#1E2A44" : "#d8ccb4" }}
            >
              <span
                className="absolute top-0.5 h-3 w-3 rounded-full bg-cream-soft transition-all"
                style={{ left: newRoom ? "0.875rem" : "0.125rem" }}
              />
            </span>
            <Plus size={13} weight="bold" />
            New Band room each run
          </button>
          {roomId && (
            <span className="truncate font-mono text-[10px] text-navy/45">room · {roomId}</span>
          )}
        </div>
      </form>

      {/* Live alerts */}
      <AnimatePresence>
        {safety && <SafetyAlert key="safety" message={safety} />}
        {correcting && <CorrectionBanner key="correcting" message={correcting} />}
      </AnimatePresence>

      {idle ? (
        <EmptyState onSample={() => run(SAMPLE_CASE)} disabled={running} />
      ) : (
        <>
          {/* Pipeline status strip */}
          <div className="rounded-3xl border border-navy-line bg-cream-soft/70 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-navy/55">
                <FlowArrow size={15} weight="bold" />
                Care pipeline
              </div>
              {running && statusLine && (
                <span className="animate-breathe font-mono text-[11px] text-navy/55">
                  {statusLine}
                </span>
              )}
            </div>
            <PipelineRail states={states} layout="horizontal" />
          </div>

          {/* Three-column clinical command grid */}
          <div className="grid gap-5 lg:grid-cols-[320px_1fr_360px]">
            <TriagePanel triage={triage} vitals={vitals} />
            <CarePlanPanel
              actions={actions}
              investigations={investigations}
              onToggle={toggleAction}
            />
            <EhrPanel note={note} bandSynced={!!outputs.documentation?.bandSynced} onSync={syncToRoom} />
          </div>

          {/* Raw agent transcript — collapsible audit trail */}
          {PIPELINE.some((id) => outputs[id]) && (
            <div className="rounded-3xl border border-navy-line bg-cream-soft/40 p-4">
              <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-navy/55">
                <FlowArrow size={15} weight="bold" />
                Agent transcript
              </div>
              <div className="space-y-2">
                {PIPELINE.map((id) =>
                  outputs[id] ? (
                    <AgentRawCard
                      key={id}
                      agent={id}
                      content={outputs[id]!.content}
                      bandSynced={outputs[id]!.bandSynced}
                      defaultOpen={id === "observer"}
                    />
                  ) : null
                )}
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-2xl border border-triage/40 bg-triage/5 px-4 py-3 text-sm text-triage">
              {error}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function EmptyState({ onSample, disabled }: { onSample: () => void; disabled: boolean }) {
  return (
    <div className="flex min-h-[42dvh] flex-col items-center justify-center rounded-3xl border border-dashed border-navy-line bg-cream-soft/40 px-6 text-center">
      <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl border border-navy/15 bg-cream-soft text-navy">
        <ListChecks size={26} weight="duotone" />
      </div>
      <h2 className="text-lg font-semibold tracking-tight text-navy">
        Emergency Clinical Command Center
      </h2>
      <p className="mt-1 max-w-md text-sm text-navy/55">
        Present a patient and five specialist agents will triage, plan management,
        prioritise investigations, draft the EHR note, and audit each other — coordinated
        live over Band.
      </p>
      <button
        type="button"
        onClick={onSample}
        disabled={disabled}
        className="mt-5 flex items-center gap-2 rounded-2xl bg-navy px-5 py-3 text-sm font-semibold text-cream transition active:scale-[0.98] disabled:opacity-50"
      >
        <Sparkle size={16} weight="fill" />
        Run sample case
      </button>
    </div>
  );
}
