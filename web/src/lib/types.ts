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
  type: "status" | "step" | "error" | "done";
  agent?: AgentId;
  agentName?: string;
  message?: string;
  step?: CascadeStep;
}
