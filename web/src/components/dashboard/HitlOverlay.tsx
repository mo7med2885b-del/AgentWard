"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { ShieldWarning, Check, ArrowBendDownRight } from "@phosphor-icons/react";

export interface HitlDecision {
  approved: boolean;
  atsOverride?: number;
  note?: string;
}

/** Pauses the pipeline after triage, requiring clinician verification. */
export function HitlOverlay({
  currentAts,
  rationale,
  category,
  onResolve,
}: {
  currentAts: number | null;
  rationale?: string;
  category?: string;
  onResolve: (d: HitlDecision) => void;
}) {
  const [override, setOverride] = useState<number | "">("");
  const [note, setNote] = useState("");

  const submit = (approved: boolean) => {
    onResolve({
      approved,
      atsOverride: override === "" ? undefined : Number(override),
      note: note.trim() || undefined,
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-navy/40 p-4 backdrop-blur-sm"
    >
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 160, damping: 20 }}
        className="w-full max-w-md overflow-hidden rounded-3xl border border-navy-line bg-cream-soft shadow-2xl"
      >
        <div className="flex items-center gap-3 bg-[#c4641f] px-6 py-4 text-white">
          <ShieldWarning size={24} weight="fill" />
          <div>
            <div className="text-sm font-semibold">Triage Pending Clinical Verification</div>
            <div className="font-mono text-[10px] uppercase tracking-widest opacity-85">
              Human-in-the-loop checkpoint
            </div>
          </div>
        </div>

        <div className="space-y-4 px-6 py-5">
          <p className="text-sm text-navy/70">
            The AI assigned{" "}
            <span className="font-semibold text-navy">
              ATS {currentAts ?? "?"}
            </span>
            . Review before the management pipeline continues.
          </p>

          <div>
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-navy/55">
              Override ATS level
            </label>
            <div className="flex gap-1.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setOverride(override === n ? "" : n)}
                  className={`h-10 flex-1 rounded-xl border text-sm font-semibold transition ${
                    override === n
                      ? "border-navy bg-navy text-cream"
                      : "border-navy-line bg-cream/50 text-navy/70 hover:border-navy/40"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-navy/55">
              Add vitals / notes
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="e.g. New onset AF on monitor; lactate 4.1…"
              className="w-full resize-none rounded-xl border border-navy-line bg-cream/40 px-3 py-2 text-sm text-navy placeholder:text-navy/35 focus:border-navy/40 focus:outline-none"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => submit(true)}
              className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-mgmt px-4 py-3 text-sm font-semibold text-white transition active:translate-y-[1px]"
            >
              <Check size={16} weight="bold" />
              {override === "" ? "Approve triage" : `Override → ATS ${override}`}
            </button>
            <button
              type="button"
              onClick={() => submit(true)}
              className="flex items-center justify-center gap-2 rounded-2xl border border-navy/25 px-4 py-3 text-sm font-medium text-navy transition active:translate-y-[1px]"
              title="Continue with the AI assessment"
            >
              <ArrowBendDownRight size={16} weight="bold" />
              Continue
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
