// Shared types for the AgentWard cascade.

export type AgentId =
  | "triage"
  | "management"
  | "investigation"
  | "documentation"
  | "observer";

export interface AgentMeta {
  id: AgentId;
  name: string;
  role: string;
  bandHandle: string;
  bandAgentId: string;
}

export interface CascadeStep {
  agent: AgentId;
  agentName: string;
  content: string;
  startedAt: string;
  finishedAt: string;
  bandSynced: boolean;
  provider: string; // which LLM provider answered (aiml / featherless)
}

export interface CascadeEvent {
  type: "status" | "step" | "error" | "done" | "pause" | "correcting" | "safety_alert";
  agent?: AgentId;
  agentName?: string;
  message?: string;
  step?: CascadeStep;
  runId?: string;
  auditFeedback?: string;
}

// Parsed from TriageAgent output
export interface TriageData {
  atsLevel: 1 | 2 | 3 | 4 | 5;
  category: string;
  color: "RED" | "ORANGE" | "YELLOW" | "GREEN" | "WHITE";
  maxWaitMinutes: number;
  summary: string;
}

// Parsed from ManagementAgent output
export interface ActionItem {
  id: string;
  text: string;
  completed: boolean;
}

// Parsed from InvestigationAgent output
export interface Investigation {
  priority: "STAT" | "URGENT" | "IMAGING" | "ECG";
  test: string;
  rationale: string;
}

// Parsed from the raw patient case
export interface Vital {
  label: string;
  value: string;
  abnormal?: boolean;
}
