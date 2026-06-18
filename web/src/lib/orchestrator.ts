// The cascade orchestrator.
//
// Phase 1 (PARALLEL): Triage + Management both run from the raw patient case.
// Phase 2 (SEQUENTIAL): Investigation -> Documentation -> Observer, each using
// the accumulated outputs.
//
// Each completed step is posted to the Band room as that agent (@mentioning the
// next where sensible), so the collaboration genuinely flows through Band.
// Steps are streamed to the UI as they complete.

import { AGENTS, SYSTEM_PROMPTS } from "./agents";
import { completeForAgent } from "./llm";
import { gatherEvidence } from "./pubmed";
import { trustedMedicalSearch } from "./tavily";
import { postToBand, createRoomWithAgents } from "./band";
import type { AgentId, CascadeEvent, CascadeStep } from "./types";

const AGENT_KEYS: Record<AgentId, string> = {
  triage: process.env.TRIAGE_API_KEY || "",
  management: process.env.MGMT_API_KEY || "",
  investigation: process.env.INVEST_API_KEY || "",
  documentation: process.env.DOC_API_KEY || "",
  observer: process.env.OBSERVER_API_KEY || "",
};

// ── ANTI-LOOP SAFEGUARDS ──────────────────────────────────────────────────
// The cascade is a FIXED linear sequence and can never call an agent twice,
// but these guards make runaway usage structurally impossible:
//   1. A global run-lock: only ONE cascade can execute at a time. A second
//      request while one is running is rejected immediately (no overlap, no
//      accidental fan-out of LLM calls).
//   2. A hard step ceiling: the loop body cannot execute more than MAX_STEPS
//      times no matter what — a circuit breaker against any future regression.
const MAX_STEPS = 5;
let cascadeRunning = false;

function nowStr(): string {
  const d = new Date(Date.now() + 3 * 3600 * 1000); // UTC+3
  return d.toISOString().slice(0, 16).replace("T", " ") + " UTC+3";
}

function maxTokensFor(agent: AgentId): number {
  // Gemini-3.5-flash + qwen are reasoning models that spend tokens "thinking"
  // before the visible answer, so budgets must be generous or content comes
  // back empty. Management/Documentation produce long output too.
  if (agent === "management" || agent === "documentation") return 6000;
  return 4000;
}

// Run one agent: call its model, post result to Band, return the step.
async function runAgent(
  agent: AgentId,
  userMsg: string,
  mentionNext: AgentId | null,
  roomId?: string
): Promise<CascadeStep> {
  const meta = AGENTS[agent];
  let systemPrompt = SYSTEM_PROMPTS[agent];
  if (agent === "documentation") systemPrompt = systemPrompt.replace("{{NOW}}", nowStr());

  const startedAt = new Date().toISOString();
  const result = await completeForAgent(agent, systemPrompt, userMsg, {
    temperature: agent === "triage" ? 0.1 : 0.2,
    maxTokens: maxTokensFor(agent),
  });
  const finishedAt = new Date().toISOString();

  const next = mentionNext ? AGENTS[mentionNext] : null;
  const bandSynced = await postToBand(
    AGENT_KEYS[agent],
    result.content,
    next ? { id: next.bandAgentId, handle: next.bandHandle, name: next.name } : undefined,
    roomId
  );

  return {
    agent,
    agentName: meta.name,
    content: result.content,
    startedAt,
    finishedAt,
    bandSynced,
    provider: result.provider,
  };
}

export async function* runCascade(
  patientCase: string,
  opts?: { newRoom?: boolean }
): AsyncGenerator<CascadeEvent> {
  // ── RUN-LOCK: refuse to start a second cascade while one is in flight. ──
  if (cascadeRunning) {
    yield {
      type: "error",
      message: "A cascade is already running. Please wait for it to finish.",
    };
    return;
  }
  cascadeRunning = true;
  let stepCount = 0; // hard ceiling guard

  try {
    // Optionally spin up a fresh Band room for this conversation.
    let roomId: string | undefined;
    if (opts?.newRoom) {
      yield { type: "status", message: "Creating a fresh Band room…" };
      const created = await createRoomWithAgents();
      if (created) {
        roomId = created;
        yield { type: "status", message: `New Band room ready: ${created}` };
      } else {
        yield { type: "status", message: "Could not create a new room — using default." };
      }
    }

    yield* runCascadeInner(patientCase, roomId, () => {
      stepCount += 1;
      if (stepCount > MAX_STEPS) {
        throw new Error(`Step ceiling (${MAX_STEPS}) exceeded — aborting to prevent loops.`);
      }
    });
  } finally {
    cascadeRunning = false; // always release the lock, even on error/abort
  }
}

async function* runCascadeInner(
  patientCase: string,
  roomId: string | undefined,
  countStep: () => void
): AsyncGenerator<CascadeEvent> {
  const caseBlock = `PATIENT CASE:\n${patientCase}`;

  // ── PHASE 1: Triage + Management in PARALLEL (both from the raw case) ──
  yield { type: "status", agent: "triage", agentName: "TriageAgent", message: "TriageAgent is working…" };
  yield {
    type: "status",
    agent: "management",
    agentName: "ManagementAgent",
    message: "ManagementAgent searching PubMed + guidelines…",
  };

  // Gather evidence for management while both LLM calls run.
  const evidencePromise = Promise.all([
    gatherEvidence(patientCase + " emergency management guidelines"),
    trustedMedicalSearch(patientCase + " management guideline"),
  ]).then(([pubmed, web]) => `\n\n---\n\nPUBMED EVIDENCE:\n${pubmed}\n\nTRUSTED GUIDELINES:\n${web}`);

  const triagePromise = runAgent("triage", caseBlock, "investigation", roomId);
  const managementPromise = evidencePromise.then((evidence) =>
    runAgent("management", caseBlock + evidence, "investigation", roomId)
  );

  // Settle both; surface each as it finishes (triage is usually faster).
  const results = await Promise.allSettled([triagePromise, managementPromise]);

  let triageStep: CascadeStep | null = null;
  let managementStep: CascadeStep | null = null;

  // Emit in a stable order (triage then management) once both settle.
  const [triageRes, mgmtRes] = results;
  if (triageRes.status === "fulfilled") {
    countStep();
    triageStep = triageRes.value;
    yield { type: "step", agent: "triage", agentName: "TriageAgent", step: triageStep };
  } else {
    yield { type: "error", agent: "triage", agentName: "TriageAgent", message: String(triageRes.reason) };
  }
  if (mgmtRes.status === "fulfilled") {
    countStep();
    managementStep = mgmtRes.value;
    yield { type: "step", agent: "management", agentName: "ManagementAgent", step: managementStep };
  } else {
    yield { type: "error", agent: "management", agentName: "ManagementAgent", message: String(mgmtRes.reason) };
  }

  if (!triageStep && !managementStep) return; // total failure

  // Accumulated context for the sequential phase.
  const transcript: string[] = [caseBlock];
  if (triageStep) transcript.push(`TriageAgent OUTPUT:\n${triageStep.content}`);
  if (managementStep) transcript.push(`ManagementAgent OUTPUT:\n${managementStep.content}`);

  // ── PHASE 2: Investigation -> Documentation -> Observer (SEQUENTIAL) ──
  const sequential: { id: AgentId; next: AgentId | null }[] = [
    { id: "investigation", next: "documentation" },
    { id: "documentation", next: "observer" },
    { id: "observer", next: null },
  ];

  for (const { id, next } of sequential) {
    const meta = AGENTS[id];
    yield { type: "status", agent: id, agentName: meta.name, message: `${meta.name} is working…` };
    try {
      countStep();
      const step = await runAgent(id, transcript.join("\n\n---\n\n"), next, roomId);
      transcript.push(`${meta.name} OUTPUT:\n${step.content}`);
      yield { type: "step", agent: id, agentName: meta.name, step };
    } catch (err) {
      yield {
        type: "error",
        agent: id,
        agentName: meta.name,
        message: err instanceof Error ? err.message : String(err),
      };
      return;
    }
  }

  yield { type: "done" };
}
