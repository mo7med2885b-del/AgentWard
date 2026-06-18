// Client-side agent display metadata: label, icon name, accent color.
// Icons resolved in components via @phosphor-icons/react.

import type { AgentId } from "./types";

export interface AgentUi {
  label: string;
  short: string;
  accent: string; // tailwind text/border color token
  hex: string;
}

export const AGENT_UI: Record<AgentId, AgentUi> = {
  triage: { label: "Triage Agent", short: "Triage", accent: "triage", hex: "#b5552e" },
  management: { label: "Management Agent", short: "Management", accent: "mgmt", hex: "#1f7d72" },
  investigation: { label: "Investigation Agent", short: "Investigation", accent: "invest", hex: "#1E2A44" },
  documentation: { label: "Documentation Agent", short: "Documentation", accent: "doc", hex: "#3f7a44" },
  observer: { label: "Observer", short: "Audit", accent: "observer", hex: "#9a7d18" },
};

export const PIPELINE: AgentId[] = [
  "triage",
  "management",
  "investigation",
  "documentation",
  "observer",
];

export const SAMPLE_CASE =
  '67yo female, sudden onset severe headache 10/10 "worst of my life", neck stiffness, photophobia, fever 38.9°C, GCS 14. BP 158/94, HR 102, RR 20, SpO2 97% on air. No known allergies. No prior headache history.';
