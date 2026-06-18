"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ClipboardText, Copy, Check, ArrowsClockwise, ShieldCheck } from "@phosphor-icons/react";

export function EhrPanel({
  note,
  bandSynced,
  onSync,
}: {
  note: string;
  bandSynced: boolean;
  onSync: () => void;
}) {
  const [draft, setDraft] = useState(note);
  const [copied, setCopied] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Keep the editor in sync with the incoming note until the clinician edits it.
  useEffect(() => {
    if (!dirty) setDraft(note);
  }, [note, dirty]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — no-op */
    }
  };

  return (
    <div className="flex h-full flex-col rounded-3xl border border-navy-line bg-cream-soft/70 p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-navy/55">
          <ClipboardText size={15} weight="bold" />
          EHR clinical note
        </div>
        {bandSynced && (
          <span className="flex items-center gap-1 font-mono text-[10px] text-mgmt">
            <ShieldCheck size={12} weight="fill" />
            synced to Band
          </span>
        )}
      </div>

      {note ? (
        <textarea
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setDirty(true);
          }}
          spellCheck={false}
          className="min-h-[280px] flex-1 resize-none rounded-2xl border border-navy-line bg-cream/40 p-4 font-mono text-[0.82rem] leading-relaxed text-navy/90 focus:border-navy/40 focus:outline-none"
        />
      ) : (
        <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-navy-line text-sm text-navy/40">
          Documentation note will appear here…
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={copy}
          disabled={!note}
          className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-navy px-4 py-2.5 text-sm font-medium text-cream transition active:translate-y-[1px] disabled:opacity-40"
        >
          {copied ? <Check size={16} weight="bold" /> : <Copy size={16} weight="bold" />}
          {copied ? "Copied" : "Copy to EHR"}
        </button>
        <button
          type="button"
          onClick={onSync}
          disabled={!note}
          className="flex items-center justify-center gap-2 rounded-2xl border border-navy/25 bg-cream-soft px-4 py-2.5 text-sm font-medium text-navy transition active:translate-y-[1px] disabled:opacity-40"
        >
          <ArrowsClockwise size={16} weight="bold" />
          Sync to Room
        </button>
      </div>

      {dirty && note && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-2 font-mono text-[10px] text-navy/45"
        >
          Edited locally — original AI draft preserved in Band.
        </motion.p>
      )}
    </div>
  );
}
