"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  CheckCircle,
  Circle,
  Lightning,
  Clock,
  Camera,
  Pulse,
  ListChecks,
  Pill,
} from "@phosphor-icons/react";
import type { ActionItem, Investigation } from "@/lib/types";

const PRIORITY_THEME: Record<
  Investigation["priority"],
  { icon: typeof Lightning; label: string; hex: string }
> = {
  STAT: { icon: Lightning, label: "STAT — order now", hex: "#b5302e" },
  URGENT: { icon: Clock, label: "Urgent — within 60 min", hex: "#c4641f" },
  IMAGING: { icon: Camera, label: "Imaging", hex: "#1f7d72" },
  ECG: { icon: Pulse, label: "ECG priorities", hex: "#1E2A44" },
};

const PRIORITY_ORDER: Investigation["priority"][] = ["STAT", "URGENT", "IMAGING", "ECG"];

export function CarePlanPanel({
  actions,
  investigations,
  onToggle,
}: {
  actions: ActionItem[];
  investigations: Investigation[];
  onToggle: (id: string) => void;
}) {
  const completed = actions.filter((a) => a.completed).length;
  const grouped = PRIORITY_ORDER.map((p) => ({
    priority: p,
    items: investigations.filter((i) => i.priority === p),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="space-y-4">
      {/* Immediate actions checklist */}
      <div className="rounded-3xl border border-navy-line bg-cream-soft/70 p-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-navy/55">
            <ListChecks size={15} weight="bold" />
            Immediate actions
          </div>
          {actions.length > 0 && (
            <span className="font-mono text-[11px] font-semibold text-navy/55">
              {completed}/{actions.length} done
            </span>
          )}
        </div>

        {actions.length === 0 ? (
          <div className="flex items-center gap-2 py-2 text-sm text-navy/45">
            <Pill size={16} weight="duotone" />
            Awaiting management plan…
          </div>
        ) : (
          <>
            {/* progress bar */}
            <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-navy/10">
              <motion.div
                className="h-full rounded-full bg-mgmt"
                initial={{ width: 0 }}
                animate={{ width: `${(completed / actions.length) * 100}%` }}
                transition={{ type: "spring", stiffness: 120, damping: 20 }}
              />
            </div>
            <ul className="space-y-1.5">
              <AnimatePresence initial={false}>
                {actions.map((a) => (
                  <motion.li
                    key={a.id}
                    layout
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                  >
                    <button
                      type="button"
                      onClick={() => onToggle(a.id)}
                      className={`flex w-full items-start gap-2.5 rounded-2xl border px-3 py-2.5 text-left transition ${
                        a.completed
                          ? "border-mgmt/30 bg-mgmt/5"
                          : "border-navy-line bg-cream/40 hover:border-navy/30"
                      }`}
                    >
                      {a.completed ? (
                        <CheckCircle size={18} weight="fill" className="mt-0.5 shrink-0 text-mgmt" />
                      ) : (
                        <Circle size={18} weight="bold" className="mt-0.5 shrink-0 text-navy/35" />
                      )}
                      <span
                        className={`text-sm leading-snug ${
                          a.completed ? "text-navy/45 line-through" : "text-navy/90"
                        }`}
                      >
                        {a.text}
                      </span>
                    </button>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </>
        )}
      </div>

      {/* Prioritised investigations board */}
      <div className="rounded-3xl border border-navy-line bg-cream-soft/70 p-5">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-navy/55">
          <Lightning size={15} weight="bold" />
          Prioritised investigations
        </div>

        {grouped.length === 0 ? (
          <p className="text-sm text-navy/45">Awaiting investigation pathway…</p>
        ) : (
          <div className="space-y-3">
            {grouped.map(({ priority, items }) => {
              const theme = PRIORITY_THEME[priority];
              const Icon = theme.icon;
              return (
                <motion.div
                  key={priority}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-2xl border border-navy-line bg-cream/40 p-3"
                >
                  <div
                    className="mb-2 flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-widest"
                    style={{ color: theme.hex }}
                  >
                    <Icon size={13} weight="fill" />
                    {theme.label}
                  </div>
                  <ul className="space-y-1.5">
                    {items.map((inv, i) => (
                      <li key={i} className="flex gap-2 text-sm">
                        <span
                          className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ background: theme.hex }}
                        />
                        <span className="leading-snug text-navy/90">
                          <span className="font-medium">{inv.test}</span>
                          {inv.rationale && (
                            <span className="text-navy/55"> — {inv.rationale}</span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
