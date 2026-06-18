"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  FirstAid,
  Pill,
  Microscope,
  ClipboardText,
  MagnifyingGlass,
  CheckCircle,
  CaretDown,
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

/**
 * Collapsible raw-output card. The dashboard surfaces parsed/structured data,
 * but each agent's full markdown response stays available here for inspection
 * (handy for demos and for clinicians who want the underlying reasoning).
 */
export function AgentRawCard({
  agent,
  content,
  provider,
  bandSynced,
  defaultOpen = false,
}: {
  agent: AgentId;
  content: string;
  provider?: string;
  bandSynced?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const ui = AGENT_UI[agent];
  const Icon = ICONS[agent];

  return (
    <motion.div layout className="overflow-hidden rounded-2xl border border-navy-line bg-cream-soft/70">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left"
      >
        <span
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border"
          style={{ borderColor: ui.hex, color: ui.hex, background: "#f6f0e4" }}
        >
          <Icon size={15} weight="duotone" />
        </span>
        <span className="flex-1 text-sm font-semibold tracking-tight" style={{ color: ui.hex }}>
          {ui.label}
        </span>
        {provider && (
          <span className="rounded-full border border-navy-line px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-navy/55">
            {provider}
          </span>
        )}
        {bandSynced && <CheckCircle size={13} weight="fill" className="text-mgmt" />}
        <motion.span animate={{ rotate: open ? 180 : 0 }} className="text-navy/45">
          <CaretDown size={15} weight="bold" />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="md border-t border-navy-line px-4 py-3 text-[0.88rem] text-navy/90">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
