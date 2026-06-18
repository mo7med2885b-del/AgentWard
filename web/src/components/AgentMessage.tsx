"use client";

import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  FirstAid,
  Pill,
  Microscope,
  ClipboardText,
  MagnifyingGlass,
  CheckCircle,
  User,
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

export function AgentMessage({
  agent,
  content,
  provider,
  bandSynced,
}: {
  agent: AgentId;
  content: string;
  provider?: string;
  bandSynced?: boolean;
}) {
  const ui = AGENT_UI[agent];
  const Icon = ICONS[agent];

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 120, damping: 20 }}
      className="grid grid-cols-[2.25rem_1fr] gap-3"
    >
      <div
        className="mt-1 grid h-9 w-9 place-items-center rounded-xl border"
        style={{ borderColor: ui.hex, color: ui.hex, background: "#f6f0e4" }}
      >
        <Icon size={18} weight="duotone" />
      </div>

      <div className="min-w-0">
        <div className="mb-1.5 flex items-center gap-2">
          <span className="text-sm font-semibold tracking-tight" style={{ color: ui.hex }}>
            {ui.label}
          </span>
          {provider && (
            <span className="rounded-full border border-navy-line px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-navy/55">
              {provider}
            </span>
          )}
          {bandSynced && (
            <span className="flex items-center gap-1 font-mono text-[10px] text-navy/55">
              <CheckCircle size={12} weight="fill" />
              synced to Band
            </span>
          )}
        </div>

        <div className="md rounded-2xl rounded-tl-sm border border-navy-line bg-cream-soft px-4 py-3 text-[0.92rem] text-navy/90 shadow-[0_12px_30px_-18px_rgba(30,42,68,0.35)]">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      </div>
    </motion.div>
  );
}

export function UserMessage({ content }: { content: string }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 120, damping: 20 }}
      className="grid grid-cols-[1fr_2.25rem] gap-3"
    >
      <div className="md min-w-0 rounded-2xl rounded-tr-sm border border-navy/15 bg-navy px-4 py-3 text-[0.92rem] text-cream">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
      <div className="mt-1 grid h-9 w-9 place-items-center rounded-xl border border-navy/20 bg-navy text-cream">
        <User size={18} weight="duotone" />
      </div>
    </motion.div>
  );
}
