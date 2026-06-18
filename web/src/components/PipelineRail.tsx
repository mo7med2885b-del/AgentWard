"use client";

import { motion } from "framer-motion";
import {
  FirstAid,
  Pill,
  Microscope,
  ClipboardText,
  MagnifyingGlass,
  CheckCircle,
  CircleNotch,
} from "@phosphor-icons/react";
import type { AgentId } from "@/lib/types";
import { AGENT_UI } from "@/lib/agent-ui";

const ICONS = {
  triage: FirstAid,
  management: Pill,
  investigation: Microscope,
  documentation: ClipboardText,
  observer: MagnifyingGlass,
} as const;

export type StageState = "idle" | "active" | "done";

/** Vertical node used in the sequential chain (icon left, label right). */
function RowNode({ id, state }: { id: AgentId; state: StageState }) {
  const ui = AGENT_UI[id];
  const Icon = ICONS[id];
  const lit = state === "active" || state === "done";
  return (
    <div className="flex items-center gap-3">
      <StageIcon id={id} state={state} Icon={Icon} />
      <div className="min-w-0">
        <div
          className="text-sm font-medium leading-tight tracking-tight"
          style={{ color: lit ? "#1e2a44" : "#9c8f74" }}
        >
          {ui.short}
        </div>
        <div
          className={`font-mono text-[10px] uppercase tracking-wide ${
            state === "active" ? "animate-breathe" : ""
          }`}
          style={{ color: state === "active" ? ui.hex : "#a99c80" }}
        >
          {state === "active" ? "working" : state === "done" ? "complete" : "queued"}
        </div>
      </div>
    </div>
  );
}

/** Compact node used in the parallel pair (icon top, label below, centered). */
function ColNode({ id, state }: { id: AgentId; state: StageState }) {
  const ui = AGENT_UI[id];
  const Icon = ICONS[id];
  const lit = state === "active" || state === "done";
  return (
    <div className="flex flex-col items-center gap-1.5 text-center">
      <StageIcon id={id} state={state} Icon={Icon} />
      <div className="leading-tight">
        <div
          className="text-xs font-semibold tracking-tight"
          style={{ color: lit ? "#1e2a44" : "#9c8f74" }}
        >
          {ui.short}
        </div>
        <div
          className={`font-mono text-[9px] uppercase tracking-wide ${
            state === "active" ? "animate-breathe" : ""
          }`}
          style={{ color: state === "active" ? ui.hex : "#a99c80" }}
        >
          {state === "active" ? "working" : state === "done" ? "done" : "queued"}
        </div>
      </div>
    </div>
  );
}

function StageIcon({
  id,
  state,
  Icon,
}: {
  id: AgentId;
  state: StageState;
  Icon: (typeof ICONS)[AgentId];
}) {
  const ui = AGENT_UI[id];
  const lit = state === "active" || state === "done";
  return (
    <div
      className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border transition-colors"
      style={{
        borderColor: lit ? ui.hex : "#d8ccb4",
        color: lit ? ui.hex : "#9c8f74",
        background: "#f6f0e4",
      }}
    >
      {state === "active" ? (
        <motion.span
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1.1, ease: "linear" }}
        >
          <CircleNotch size={18} weight="bold" />
        </motion.span>
      ) : state === "done" ? (
        <CheckCircle size={18} weight="fill" />
      ) : (
        <Icon size={18} weight="duotone" />
      )}
    </div>
  );
}

export function PipelineRail({ states }: { states: Record<AgentId, StageState> }) {
  const sequential: AgentId[] = ["investigation", "documentation", "observer"];
  const triageLit = states.triage === "active" || states.triage === "done";
  const mgmtLit = states.management === "active" || states.management === "done";

  return (
    <div className="flex flex-col">
      <div className="mb-2 flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-navy/40" />
        <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-navy/50">
          run in parallel
        </span>
      </div>

      {/* ── Parallel pair: side by side ── */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-navy-line bg-cream/50 py-3">
          <ColNode id="triage" state={states.triage} />
        </div>
        <div className="rounded-2xl border border-navy-line bg-cream/50 py-3">
          <ColNode id="management" state={states.management} />
        </div>
      </div>

      {/* ── Converging connector: a line from each of the two boxes meeting,
             then a single line down into Investigation ── */}
      <svg viewBox="0 0 200 44" className="h-11 w-full" preserveAspectRatio="none" aria-hidden="true">
        {/* left box bottom-center (~x=50) down then in to center */}
        <path
          d="M50 0 L50 16 Q50 24 100 24 L100 44"
          fill="none"
          stroke={triageLit ? AGENT_UI.triage.hex : "#d8ccb4"}
          strokeWidth="1.5"
        />
        {/* right box bottom-center (~x=150) down then in to center */}
        <path
          d="M150 0 L150 16 Q150 24 100 24 L100 44"
          fill="none"
          stroke={mgmtLit ? AGENT_UI.management.hex : "#d8ccb4"}
          strokeWidth="1.5"
        />
      </svg>

      {/* ── Sequential chain ── */}
      <div className="flex flex-col gap-1">
        {sequential.map((id, i) => {
          const ui = AGENT_UI[id];
          return (
            <div key={id} className="relative flex items-center py-1">
              {i < sequential.length - 1 && (
                <span
                  className="absolute left-[1.05rem] top-9 h-[calc(100%-1.25rem)] w-px"
                  style={{ background: states[id] === "done" ? ui.hex : "#d8ccb4" }}
                />
              )}
              <RowNode id={id} state={states[id]} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
