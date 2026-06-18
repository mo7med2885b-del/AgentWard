"use client";

import { useCallback, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { PaperPlaneRight, Sparkle, Stethoscope, Plus } from "@phosphor-icons/react";
import type { AgentId, CascadeEvent, CascadeStep } from "@/lib/types";
import { PIPELINE, SAMPLE_CASE } from "@/lib/agent-ui";
import { AgentMessage, UserMessage } from "./AgentMessage";
import { PipelineRail, type StageState } from "./PipelineRail";

type Bubble =
  | { kind: "user"; content: string }
  | { kind: "agent"; agent: AgentId; content: string; provider?: string; bandSynced?: boolean };

const idleStates = (): Record<AgentId, StageState> =>
  PIPELINE.reduce((acc, id) => ({ ...acc, [id]: "idle" }), {} as Record<AgentId, StageState>);

export function Console() {
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [states, setStates] = useState<Record<AgentId, StageState>>(idleStates());
  const [running, setRunning] = useState(false);
  const [statusLine, setStatusLine] = useState("");
  const [error, setError] = useState("");
  const [input, setInput] = useState("");
  const [newRoom, setNewRoom] = useState(true);
  const [roomId, setRoomId] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    });
  }, []);

  const run = useCallback(
    async (caseText: string) => {
      if (running || !caseText.trim()) return;
      setRunning(true);
      setError("");
      setStates(idleStates());
      setBubbles([{ kind: "user", content: caseText }]);
      setRoomId("");
      setStatusLine("Connecting to the agent board…");
      scrollToEnd();

      try {
        const res = await fetch("/api/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ case: caseText, newRoom }),
        });
        if (!res.ok || !res.body) {
          throw new Error(`Server error ${res.status}`);
        }

        const reader = res.body.getReader();
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
            const ev = JSON.parse(line.slice(5).trim()) as CascadeEvent;
            handleEvent(ev);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setRunning(false);
        setStatusLine("");
        scrollToEnd();
      }
    },
    [running, scrollToEnd, newRoom]
  );

  const handleEvent = useCallback(
    (ev: CascadeEvent) => {
      // Capture a freshly-created room id from its status message.
      if (ev.type === "status" && ev.message) {
        const m = ev.message.match(/New Band room ready:\s*([0-9a-f-]{8,})/i);
        if (m) setRoomId(m[1]);
      }
      if (ev.type === "status" && ev.agent) {
        setStates((s) => ({ ...s, [ev.agent as AgentId]: "active" }));
        setStatusLine(ev.message ?? "");
        scrollToEnd();
      } else if (ev.type === "step" && ev.step) {
        const step = ev.step as CascadeStep;
        setStates((s) => ({ ...s, [step.agent]: "done" }));
        setBubbles((b) => [
          ...b,
          {
            kind: "agent",
            agent: step.agent,
            content: step.content,
            provider: step.provider,
            bandSynced: step.bandSynced,
          },
        ]);
        scrollToEnd();
      } else if (ev.type === "error") {
        setError(ev.message ?? "Unknown error");
      } else if (ev.type === "done") {
        setStatusLine("");
      }
    },
    [scrollToEnd]
  );

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    run(input);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
      {/* Pipeline rail */}
      <aside className="lg:sticky lg:top-6 lg:self-start">
        <div className="rounded-3xl border border-navy-line bg-cream-soft/70 p-5">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-navy/55">
            <Stethoscope size={15} weight="bold" />
            Care pipeline
          </div>
          <PipelineRail states={states} />
        </div>

        {/* Fresh-room toggle */}
        <button
          type="button"
          onClick={() => setNewRoom((v) => !v)}
          disabled={running}
          className="mt-3 flex w-full items-center justify-between gap-2 rounded-2xl border border-navy/20 bg-cream-soft px-4 py-2.5 text-sm font-medium text-navy transition active:translate-y-[1px] disabled:opacity-50"
          aria-pressed={newRoom}
        >
          <span className="flex items-center gap-2">
            <Plus size={15} weight="bold" />
            New Band room each run
          </span>
          <span
            className="relative h-5 w-9 rounded-full transition-colors"
            style={{ background: newRoom ? "#1E2A44" : "#d8ccb4" }}
          >
            <span
              className="absolute top-0.5 h-4 w-4 rounded-full bg-cream-soft transition-all"
              style={{ left: newRoom ? "1.25rem" : "0.125rem" }}
            />
          </span>
        </button>

        {roomId && (
          <div className="mt-2 truncate rounded-xl border border-navy-line bg-cream-soft/60 px-3 py-2 font-mono text-[10px] text-navy/60">
            room · {roomId}
          </div>
        )}

        <button
          type="button"
          onClick={() => {
            setInput(SAMPLE_CASE);
            run(SAMPLE_CASE);
          }}
          disabled={running}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl border border-navy/20 bg-cream-soft px-4 py-2.5 text-sm font-medium text-navy transition active:translate-y-[1px] disabled:opacity-50"
        >
          <Sparkle size={15} weight="fill" />
          Run sample case
        </button>
      </aside>

      {/* Conversation */}
      <section className="flex min-h-[60dvh] flex-col">
        <div
          ref={scrollRef}
          className="flex-1 space-y-5 overflow-y-auto pr-1"
          style={{ maxHeight: "calc(100dvh - 16rem)" }}
        >
          {bubbles.length === 0 && <EmptyState />}

          <AnimatePresence initial={false}>
            {bubbles.map((b, i) =>
              b.kind === "user" ? (
                <UserMessage key={i} content={b.content} />
              ) : (
                <AgentMessage
                  key={i}
                  agent={b.agent}
                  content={b.content}
                  provider={b.provider}
                  bandSynced={b.bandSynced}
                />
              )
            )}
          </AnimatePresence>

          {running && statusLine && (
            <div className="flex items-center gap-2 pl-12 font-mono text-xs text-navy/55">
              <span className="inline-flex gap-1">
                <Dot /> <Dot delay={0.15} /> <Dot delay={0.3} />
              </span>
              {statusLine}
            </div>
          )}

          {error && (
            <div className="rounded-2xl border border-triage/40 bg-triage/5 px-4 py-3 text-sm text-triage">
              {error}
            </div>
          )}
        </div>

        {/* Composer */}
        <form onSubmit={onSubmit} className="mt-5">
          <div className="flex items-end gap-2 rounded-3xl border border-navy/20 bg-cream-soft p-2 focus-within:border-navy/40">
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
              placeholder="Describe the patient: age, complaint, vitals…"
              disabled={running}
              className="max-h-40 flex-1 resize-none bg-transparent px-3 py-2 text-[0.95rem] text-navy placeholder:text-navy/35 focus:outline-none disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={running || !input.trim()}
              className="grid h-11 w-11 place-items-center rounded-2xl bg-navy text-cream transition active:scale-[0.96] disabled:opacity-40"
              aria-label="Run cascade"
            >
              <PaperPlaneRight size={18} weight="fill" />
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function Dot({ delay = 0 }: { delay?: number }) {
  return (
    <motion.span
      className="inline-block h-1.5 w-1.5 rounded-full bg-navy/40"
      animate={{ opacity: [0.3, 1, 0.3] }}
      transition={{ repeat: Infinity, duration: 1, delay }}
    />
  );
}

function EmptyState() {
  return (
    <div className="flex h-full min-h-[40dvh] flex-col items-center justify-center text-center">
      <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl border border-navy/15 bg-cream-soft text-navy">
        <Stethoscope size={26} weight="duotone" />
      </div>
      <h2 className="text-lg font-semibold tracking-tight text-navy">
        Present a case to the board
      </h2>
      <p className="mt-1 max-w-sm text-sm text-navy/55">
        Five specialist agents will triage, plan, investigate, document, and audit it
        together, coordinating each handoff over Band.
      </p>
    </div>
  );
}
