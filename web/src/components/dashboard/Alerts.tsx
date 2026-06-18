"use client";

import { motion } from "framer-motion";
import { Warning, ArrowsClockwise } from "@phosphor-icons/react";

/** Blinking critical banner for medication/allergy contraindications. */
export function SafetyAlert({ message }: { message: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="overflow-hidden rounded-2xl border-2 border-[#b5302e] bg-[#b5302e]/8"
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <motion.span
          animate={{ opacity: [1, 0.3, 1] }}
          transition={{ repeat: Infinity, duration: 1 }}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#b5302e] text-white"
        >
          <Warning size={18} weight="fill" />
        </motion.span>
        <div>
          <div className="font-mono text-[10px] font-semibold uppercase tracking-widest text-[#b5302e]">
            Critical safety alert
          </div>
          <div className="text-sm font-medium text-navy">{message}</div>
        </div>
      </div>
    </motion.div>
  );
}

/** Animated overlay shown while the Observer triggers a self-correction retry. */
export function CorrectionBanner({ message }: { message: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="flex items-center gap-3 rounded-2xl border border-observer/40 bg-observer/8 px-4 py-3"
    >
      <motion.span
        animate={{ rotate: 360 }}
        transition={{ repeat: Infinity, duration: 1.1, ease: "linear" }}
        className="text-observer"
      >
        <ArrowsClockwise size={18} weight="bold" />
      </motion.span>
      <div>
        <div className="font-mono text-[10px] font-semibold uppercase tracking-widest text-observer">
          Observer self-correction
        </div>
        <div className="text-sm font-medium text-navy">{message}</div>
      </div>
    </motion.div>
  );
}
