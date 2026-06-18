"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Heartbeat, Timer, Warning } from "@phosphor-icons/react";
import type { TriageData, Vital } from "@/lib/types";

// ATS colour → on-cream palette. Each entry drives the urgency card surface.
const ATS_THEME: Record<TriageData["color"], { bg: string; fg: string; ring: string; label: string }> = {
  RED: { bg: "#b5302e", fg: "#fff", ring: "#7e1f1d", label: "Resuscitation" },
  ORANGE: { bg: "#c4641f", fg: "#fff", ring: "#8a4513", label: "Emergency" },
  YELLOW: { bg: "#caa019", fg: "#1e2a44", ring: "#8f7012", label: "Urgent" },
  GREEN: { bg: "#3f7a44", fg: "#fff", ring: "#2c5630", label: "Semi-urgent" },
  WHITE: { bg: "#f6f0e4", fg: "#1e2a44", ring: "#d8ccb4", label: "Non-urgent" },
};

function fmt(s: number): string {
  if (s <= 0) return "00:00";
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/** Countdown clock that ticks down from the ATS max-wait window. */
function WaitClock({ minutes }: { minutes: number }) {
  const [remaining, setRemaining] = useState(minutes * 60);

  useEffect(() => {
    setRemaining(minutes * 60);
    if (minutes <= 0) return;
    const id = setInterval(() => setRemaining((r) => (r > 0 ? r - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [minutes]);

  const breach = minutes > 0 && remaining === 0;

  if (minutes <= 0) {
    return (
      <div className="flex items-center gap-2 font-mono text-sm font-semibold text-[#b5302e]">
        <Timer size={16} weight="fill" />
        SEE IMMEDIATELY
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Timer size={16} weight={breach ? "fill" : "bold"} className={breach ? "text-[#b5302e]" : ""} />
      <span
        className={`font-mono text-sm font-semibold tabular-nums ${
          breach ? "animate-pulse text-[#b5302e]" : "text-navy"
        }`}
      >
        {breach ? "WAIT BREACHED" : `${fmt(remaining)} to target`}
      </span>
    </div>
  );
}

export function TriagePanel({
  triage,
  vitals,
  liveText,
}: {
  triage: TriageData | null;
  vitals: Vital[];
  liveText?: string;
}) {
  // While the triage agent is still streaming and we have no parsed card yet,
  // show the live tokens (markdown-rendered) inside the card area.
  const streaming = !triage && !!liveText && liveText.trim().length > 0;

  return (
    <div className="space-y-4">
      {/* Live triage stream — shown until the parsed urgency card is ready */}
      {streaming && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="overflow-hidden rounded-3xl border border-triage/40 bg-cream-soft/80 px-5 py-4"
        >
          <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-triage">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-triage" />
            Triage assessing…
          </div>
          <div className="md text-[0.9rem] leading-snug text-navy/90">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{liveText}</ReactMarkdown>
          </div>
        </motion.div>
      )}

      {/* Urgency card */}
      {triage ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: "spring", stiffness: 140, damping: 18 }}
          className="overflow-hidden rounded-3xl border shadow-[0_18px_40px_-22px_rgba(30,42,68,0.5)]"
          style={{ background: ATS_THEME[triage.color].bg, borderColor: ATS_THEME[triage.color].ring }}
        >
          <div className="px-5 py-5" style={{ color: ATS_THEME[triage.color].fg }}>
            <div className="flex items-start justify-between">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.2em] opacity-80">
                  Triage category
                </div>
                <div className="mt-1 text-4xl font-bold leading-none tracking-tight">
                  ATS {triage.atsLevel}
                </div>
                <div className="mt-1 text-sm font-medium opacity-90">{triage.category}</div>
              </div>
              <span
                className="rounded-full border px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-widest"
                style={{ borderColor: ATS_THEME[triage.color].fg + "55" }}
              >
                {triage.color}
              </span>
            </div>

            <div className="mt-4 border-t pt-3" style={{ borderColor: ATS_THEME[triage.color].fg + "33" }}>
              <WaitClock minutes={triage.maxWaitMinutes} />
            </div>

            {triage.summary && (
              <div className="md mt-3 text-[0.9rem] leading-snug opacity-95">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{triage.summary}</ReactMarkdown>
              </div>
            )}
          </div>
        </motion.div>
      ) : streaming ? null : (
        <div className="flex items-center gap-3 rounded-3xl border border-navy-line bg-cream-soft/60 px-5 py-6 text-navy/45">
          <Heartbeat size={22} weight="duotone" />
          <span className="text-sm">Awaiting triage assessment…</span>
        </div>
      )}

      {/* Vitals */}
      <div className="rounded-3xl border border-navy-line bg-cream-soft/70 p-5">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-navy/55">
          <Heartbeat size={15} weight="bold" />
          Clinical vitals
        </div>
        {vitals.length === 0 ? (
          <p className="text-sm text-navy/45">No vitals parsed from the case.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2.5">
            {vitals.map((v) => (
              <div
                key={v.label}
                className={`rounded-2xl border px-3 py-2.5 ${
                  v.abnormal ? "border-[#b5302e]/40 bg-[#b5302e]/5" : "border-navy-line bg-cream/40"
                }`}
              >
                <div className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wide text-navy/50">
                  {v.label}
                  {v.abnormal && <Warning size={11} weight="fill" className="text-[#b5302e]" />}
                </div>
                <div
                  className={`text-base font-semibold tabular-nums ${
                    v.abnormal ? "text-[#b5302e]" : "text-navy"
                  }`}
                >
                  {v.value}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
