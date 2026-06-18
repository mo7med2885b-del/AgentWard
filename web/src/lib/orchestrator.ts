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
import { streamForAgent } from "./llm";
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
// The cascade has safeguards:
//   1. A global run-lock: only ONE cascade can execute at a time.
//   2. A hard step ceiling: the loop body cannot execute more than MAX_STEPS times.
const MAX_STEPS = 12; // Increased to 12 to support Self-Correction loops
let cascadeRunning = false;

// ── HUMAN-IN-THE-LOOP STATE ────────────────────────────────────────────────
export interface ResumeData {
  approved: boolean;
  atsOverride?: number;
  note?: string;
}
export interface PendingRun {
  resolve: (value: ResumeData) => void;
}
// Stored on globalThis so the /api/run and /api/run/resume route modules share
// ONE Map. Next.js can instantiate route modules separately (esp. in dev), so a
// plain module-level `new Map()` would give each route its own copy — the
// resume would never find the paused run (404 "Run not found"). The global
// singleton guarantees both routes see the same pending-run registry.
const globalForRuns = globalThis as unknown as {
  __agentwardPendingRuns?: Map<string, PendingRun>;
};
export const pendingRuns: Map<string, PendingRun> =
  globalForRuns.__agentwardPendingRuns ?? (globalForRuns.__agentwardPendingRuns = new Map());

// ── ALLERGY SAFETY CHECKER ─────────────────────────────────────────────────
function checkAllergies(patientCase: string): { allergy: string; warnings: string[] } | null {
  const lowercase = patientCase.toLowerCase();
  const allergiesMap = [
    {
      category: "PENICILLINS & BETA-LACTAMS",
      keywords: ["penicillin", "amoxicillin", "ampicillin", "piperacillin", "tazobactam", "augmentin", "beta-lactam"],
      warnings: ["Penicillin G/V", "Amoxicillin", "Ampicillin", "Piperacillin/Tazobactam (Zosyn)", "Augmentin", "Ceftriaxone (Rocephin)", "Cephalexin (Keflex)"],
    },
    {
      category: "ASPIRIN & SALICYLATES",
      keywords: ["aspirin", "asa", "salicylate", "acetylsalicylic"],
      warnings: ["Aspirin", "Ecotrin", "ASA-containing compounds"],
    },
    {
      category: "NSAIDS",
      keywords: ["nsaid", "ibuprofen", "naproxen", "ketorolac", "toradol", "diclofenac", "celebrex", "celecoxib", "meloxicam"],
      warnings: ["Ibuprofen (Advil/Motrin)", "Naproxen (Aleve)", "Ketorolac (Toradol)", "Diclofenac", "Celecoxib (Celebrex)", "Meloxicam"],
    },
    {
      category: "SULFA DRUGS",
      keywords: ["sulfa", "sulfamethoxazole", "bactrim", "septra", "sulfonamide"],
      warnings: ["Bactrim (Sulfamethoxazole/Trimethoprim)", "Septra", "Sulfadiazine", "Sulfasalazine"],
    },
    {
      category: "OPIOIDS",
      keywords: ["morphine", "codeine", "oxycodone", "hydrocodone", "fentanyl", "hydromorphone", "dilaudid", "tramadol", "opioid", "narcotic"],
      warnings: ["Morphine", "Codeine", "Oxycodone (Percocet/OxyContin)", "Hydrocodone (Vicodin)", "Fentanyl", "Hydromorphone (Dilaudid)", "Tramadol"],
    },
    {
      category: "IV CONTRAST MEDIA",
      keywords: ["contrast", "dye", "gadolinium", "iodine contrast"],
      warnings: ["Iodinated contrast agents", "Gadolinium-based contrast agents"],
    },
    {
      category: "LATEX",
      keywords: ["latex"],
      warnings: ["Latex urinary catheters", "Latex-containing gloves and medical supplies"],
    },
    {
      category: "LOCAL ANESTHETICS",
      keywords: ["lidocaine", "bupivacaine", "novocaine", "xylocaine", "sensocaine"],
      warnings: ["Lidocaine", "Bupivacaine", "Novocaine", "Xylocaine", "Mepivacaine"],
    },
    {
      category: "ACE INHIBITORS",
      keywords: ["lisinopril", "enalapril", "ramipril", "benazepril", "ace inhibitor", "ace-inhibitor"],
      warnings: ["Lisinopril", "Enalapril", "Ramipril", "Benazepril (Risk of Angioedema)"],
    },
    {
      category: "STATINS",
      keywords: ["statin", "atorvastatin", "simvastatin", "rosuvastatin", "lipitor", "crestor"],
      warnings: ["Atorvastatin (Lipitor)", "Simvastatin (Zocor)", "Rosuvastatin (Crestor)"],
    },
    {
      category: "ANTICONVULSANTS",
      keywords: ["phenytoin", "dilantin", "carbamazepine", "tegretol", "lamotrigine", "lamictal"],
      warnings: ["Phenytoin (Dilantin)", "Carbamazepine (Tegretol)", "Lamotrigine (Lamictal)"],
    }
  ];

  for (const group of allergiesMap) {
    for (const keyword of group.keywords) {
      if (lowercase.includes(keyword)) {
        return {
          allergy: group.category,
          warnings: group.warnings,
        };
      }
    }
  }
  return null;
}

const AGENT_NAME_TO_ID: Record<string, AgentId> = {
  Triage: "triage",
  Management: "management",
  Investigation: "investigation",
  Documentation: "documentation",
};

function nowStr(): string {
  const d = new Date(Date.now() + 3 * 3600 * 1000); // UTC+3
  return d.toISOString().slice(0, 16).replace("T", " ") + " UTC+3";
}

function maxTokensFor(agent: AgentId): number {
  if (agent === "management" || agent === "documentation") return 6000;
  return 4000;
}

// Run one agent as a generator: streams `token` events live as the model
// produces text, posts the final result to Band, and yields a final `step`
// event. The terminal `step` event carries the completed CascadeStep so callers
// can capture the content for downstream agents.
async function* runAgent(
  agent: AgentId,
  userMsg: string,
  mentionNext: AgentId | null,
  roomId?: string,
  temperatureOverride?: number
): AsyncGenerator<CascadeEvent, CascadeStep> {
  const meta = AGENTS[agent];
  let systemPrompt = SYSTEM_PROMPTS[agent];
  if (agent === "documentation") systemPrompt = systemPrompt.replace("{{NOW}}", nowStr());

  const startedAt = new Date().toISOString();

  // Collect token deltas into a queue that the generator drains between awaits,
  // so tokens reach the client as they arrive rather than all at the end.
  const queue: string[] = [];
  let resolveWaiter: (() => void) | null = null;
  const onToken = (delta: string) => {
    queue.push(delta);
    resolveWaiter?.();
    resolveWaiter = null;
  };

  const resultPromise = streamForAgent(agent, systemPrompt, userMsg, onToken, {
    temperature: temperatureOverride ?? (agent === "triage" ? 0.1 : 0.2),
    maxTokens: maxTokensFor(agent),
  });

  // Drain tokens until the model call settles.
  let settled = false;
  resultPromise.finally(() => {
    settled = true;
    resolveWaiter?.();
    resolveWaiter = null;
  });

  while (!settled || queue.length > 0) {
    if (queue.length > 0) {
      const delta = queue.shift()!;
      yield { type: "token", agent, agentName: meta.name, delta };
      continue;
    }
    if (settled) break;
    await new Promise<void>((r) => (resolveWaiter = r));
  }

  const result = await resultPromise; // re-throws if the stream failed
  const finishedAt = new Date().toISOString();

  const next = mentionNext ? AGENTS[mentionNext] : null;
  const bandSynced = await postToBand(
    AGENT_KEYS[agent],
    result.content,
    next ? { id: next.bandAgentId, handle: next.bandHandle, name: next.name } : undefined,
    roomId
  );

  const step: CascadeStep = {
    agent,
    agentName: meta.name,
    content: result.content,
    startedAt,
    finishedAt,
    bandSynced,
    provider: result.provider,
  };
  yield { type: "step", agent, agentName: meta.name, step };
  return step;
}

export async function* runCascade(
  patientCase: string,
  opts?: { newRoom?: boolean }
): AsyncGenerator<CascadeEvent> {
  if (cascadeRunning) {
    yield {
      type: "error",
      message: "A cascade is already running. Please wait for it to finish.",
    };
    return;
  }
  cascadeRunning = true;
  let stepCount = 0;

  try {
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
    cascadeRunning = false;
  }
}

async function* runCascadeInner(
  patientCase: string,
  roomId: string | undefined,
  countStep: () => void
): AsyncGenerator<CascadeEvent> {
  // Use roomId or create a random runId for tracking state
  const runId = roomId || `run-${Math.random().toString(36).substring(2, 11)}`;

  // 1. ALLERGY SAFETY CHECKER — always report a status so the clinician knows
  // the check ran, even when nothing is flagged.
  const allergyInfo = checkAllergies(patientCase);
  if (allergyInfo) {
    yield {
      type: "safety_alert",
      message: `Patient has suspected allergy to: ${allergyInfo.allergy.toUpperCase()}. Avoid: ${allergyInfo.warnings.join(", ")}.`,
    };
  } else {
    yield {
      type: "safety_alert",
      message: "__CLEAR__No medication allergies detected in the case. Standard formulary applies.",
    };
  }

  let caseBlock = `PATIENT CASE:\n${patientCase}`;
  let finalManagementCaseBlock = caseBlock;
  if (allergyInfo) {
    finalManagementCaseBlock += `\n\nCRITICAL SAFETY WARNING: Patient is allergic to ${allergyInfo.allergy.toUpperCase()}. DO NOT prescribe or recommend any of the following medications: ${allergyInfo.warnings.join(", ")}. If these drugs would normally be indicated, you MUST specify a safe alternative class of drug and clearly document the reason for the substitution.`;
  }

  // Kick off evidence gathering immediately so it's ready by the time the
  // Management agent runs (after the clinician verifies triage). This keeps the
  // expensive PubMed/Tavily lookups off the critical path without forcing
  // Management to run before the human checkpoint.
  const evidencePromise = Promise.all([
    gatherEvidence(patientCase + " emergency management guidelines"),
    trustedMedicalSearch(patientCase + " management guideline"),
  ]).then(([pubmed, web]) => `\n\n---\n\nPUBMED EVIDENCE:\n${pubmed}\n\nTRUSTED GUIDELINES:\n${web}`);

  // ── PHASE 1: Triage ONLY — streams, then pauses for clinician verification
  //    BEFORE the management plan is built. This is the correct clinical order:
  //    the doctor confirms/overrides the priority first. ──
  yield { type: "status", agent: "triage", agentName: "TriageAgent", message: "TriageAgent is working…" };
  countStep();
  let triageStep: CascadeStep | null = yield* runAgent("triage", caseBlock, "management", roomId);

  if (!triageStep) return;

  // ── HUMAN-IN-THE-LOOP PAUSE POINT (right after triage) ──
  yield {
    type: "pause",
    runId,
    message: "Triage complete — awaiting clinician verification before management planning.",
  };

  const resumePromise = new Promise<ResumeData>((resolve) => {
    pendingRuns.set(runId, { resolve });
  });

  const resumeData = await resumePromise;
  pendingRuns.delete(runId);

  let triageContent = triageStep?.content || "";

  if (resumeData.approved && resumeData.atsOverride) {
    const waitTimes = [0, 0, 10, 30, 60, 120];
    triageContent = `TRIAGE: ATS ${resumeData.atsOverride} | Clinician Overridden | Max wait: ${waitTimes[resumeData.atsOverride]} minutes\n**SUMMARY:** [Clinician Overridden] Case prioritisation verified and adjusted by doctor.`;
    if (triageStep) {
      triageStep.content = triageContent;
      yield { type: "step", agent: "triage", agentName: "TriageAgent", step: triageStep };
    }
  }

  // ── PHASE 2: Management plan (now informed by the verified triage + any
  //    clinician note). Streams live. ──
  const clinicianNote =
    resumeData.approved && resumeData.note ? `\n\nCLINICIAN INPUT:\n${resumeData.note}` : "";
  yield {
    type: "status",
    agent: "management",
    agentName: "ManagementAgent",
    message: "ManagementAgent building evidence-based plan…",
  };
  countStep();
  const evidence = await evidencePromise;
  let managementStep: CascadeStep | null = yield* runAgent(
    "management",
    `${finalManagementCaseBlock}\n\nVERIFIED TRIAGE:\n${triageContent}${clinicianNote}${evidence}`,
    "investigation",
    roomId
  );
  let managementContent = managementStep?.content || "";

  // Helper to compile transcript for sequential agents
  let investigationContent = "";
  let documentationContent = "";
  let observerContent = "";

  function compileTranscriptFor(target: AgentId): string {
    const parts = [caseBlock];
    if (triageContent) parts.push(`TriageAgent OUTPUT:\n${triageContent}`);
    if (managementContent) parts.push(`ManagementAgent OUTPUT:\n${managementContent}`);
    if (resumeData.approved && resumeData.note) parts.push(`CLINICIAN INPUT:\n${resumeData.note}`);
    if (investigationContent && target !== "investigation") {
      parts.push(`InvestigationAgent OUTPUT:\n${investigationContent}`);
    }
    if (documentationContent && target !== "documentation" && target !== "investigation") {
      parts.push(`DocumentationAgent OUTPUT:\n${documentationContent}`);
    }
    return parts.join("\n\n---\n\n");
  }

  // ── PHASE 2: Initial Sequential Runs ──
  yield { type: "status", agent: "investigation", agentName: "InvestigationAgent", message: "InvestigationAgent is working…" };
  countStep();
  let investigationStep = yield* runAgent("investigation", compileTranscriptFor("investigation"), "documentation", roomId);
  investigationContent = investigationStep.content;

  yield { type: "status", agent: "documentation", agentName: "DocumentationAgent", message: "DocumentationAgent is working…" };
  countStep();
  let documentationStep = yield* runAgent("documentation", compileTranscriptFor("documentation"), "observer", roomId);
  documentationContent = documentationStep.content;

  // ── PHASE 3: Audit + Self-Correction Loop ──
  const retriedAgents = new Set<AgentId>();
  let observerStep: CascadeStep | null = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    yield { type: "status", agent: "observer", agentName: "ObserverAgent", message: `ObserverAgent auditing (Attempt ${attempt})…` };
    countStep();
    observerStep = yield* runAgent("observer", compileTranscriptFor("observer"), null, roomId);
    observerContent = observerStep.content;

    // Find lines matching "[!] Agent" indicating a failure
    const failureMatches = [...observerContent.matchAll(/\[!\]\s*(Triage|Management|Investigation|Documentation)\s*—\s*(.*)/gi)];
    
    if (failureMatches.length === 0 || attempt === 2) {
      break; // No failures or we already did the retry
    }

    // Identify first retryable failed agent
    let agentToRetry: AgentId | null = null;
    let failureReason = "";
    for (const match of failureMatches) {
      const name = match[1];
      const reason = match[2];
      const agentId = AGENT_NAME_TO_ID[name.charAt(0).toUpperCase() + name.slice(1).toLowerCase()];
      if (agentId && !retriedAgents.has(agentId)) {
        agentToRetry = agentId;
        failureReason = reason;
        break;
      }
    }

    if (!agentToRetry) break;

    retriedAgents.add(agentToRetry);

    // Yield correcting event to client
    yield {
      type: "correcting",
      agent: agentToRetry,
      agentName: AGENTS[agentToRetry].name,
      message: `Observer flagged error in ${AGENTS[agentToRetry].name}: "${failureReason}". Retrying with audit feedback...`,
      auditFeedback: failureReason,
    };

    const correctionCritique = `\n\nCRITICAL QUALITY FEEDBACK FROM OBSERVER:\nYour previous attempt failed the quality audit with error: "${failureReason}".\nPlease regenerate your response and fix this issue completely.`;

    if (agentToRetry === "triage") {
      yield { type: "status", agent: "triage", agentName: "TriageAgent", message: "Retrying TriageAgent with feedback…" };
      triageStep = yield* runAgent("triage", caseBlock + correctionCritique, "investigation", roomId, 0.45);
      triageContent = triageStep.content;
    } else if (agentToRetry === "management") {
      yield { type: "status", agent: "management", agentName: "ManagementAgent", message: "Retrying ManagementAgent with feedback…" };
      managementStep = yield* runAgent("management", finalManagementCaseBlock + (await evidencePromise) + correctionCritique, "investigation", roomId, 0.45);
      managementContent = managementStep.content;
    } else if (agentToRetry === "investigation") {
      yield { type: "status", agent: "investigation", agentName: "InvestigationAgent", message: "Retrying InvestigationAgent with feedback…" };
      investigationStep = yield* runAgent("investigation", compileTranscriptFor("investigation") + correctionCritique, "documentation", roomId, 0.45);
      investigationContent = investigationStep.content;
    } else if (agentToRetry === "documentation") {
      yield { type: "status", agent: "documentation", agentName: "DocumentationAgent", message: "Retrying DocumentationAgent with feedback…" };
      documentationStep = yield* runAgent("documentation", compileTranscriptFor("documentation") + correctionCritique, "observer", roomId, 0.45);
      documentationContent = documentationStep.content;
    }

    // Re-run downstream dependents
    if (agentToRetry === "triage" || agentToRetry === "management") {
      yield { type: "status", agent: "investigation", agentName: "InvestigationAgent", message: "Re-running InvestigationAgent downstream…" };
      investigationStep = yield* runAgent("investigation", compileTranscriptFor("investigation"), "documentation", roomId);
      investigationContent = investigationStep.content;
    }

    if (agentToRetry === "triage" || agentToRetry === "management" || agentToRetry === "investigation") {
      yield { type: "status", agent: "documentation", agentName: "DocumentationAgent", message: "Re-running DocumentationAgent downstream…" };
      documentationStep = yield* runAgent("documentation", compileTranscriptFor("documentation"), "observer", roomId);
      documentationContent = documentationStep.content;
    }
  }

  yield { type: "done" };
}
