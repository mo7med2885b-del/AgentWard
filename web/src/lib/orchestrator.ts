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
export const pendingRuns = new Map<string, PendingRun>();

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

// Run one agent: call its model, post result to Band, return the step.
async function runAgent(
  agent: AgentId,
  userMsg: string,
  mentionNext: AgentId | null,
  roomId?: string,
  temperatureOverride?: number
): Promise<CascadeStep> {
  const meta = AGENTS[agent];
  let systemPrompt = SYSTEM_PROMPTS[agent];
  if (agent === "documentation") systemPrompt = systemPrompt.replace("{{NOW}}", nowStr());

  const startedAt = new Date().toISOString();
  const result = await completeForAgent(agent, systemPrompt, userMsg, {
    temperature: temperatureOverride ?? (agent === "triage" ? 0.1 : 0.2),
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

  // 1. ALLERGY SAFETY CHECKER
  const allergyInfo = checkAllergies(patientCase);
  if (allergyInfo) {
    yield {
      type: "safety_alert",
      message: `Patient has suspected allergy to: ${allergyInfo.allergy.toUpperCase()}. Avoid: ${allergyInfo.warnings.join(", ")}.`,
    };
  }

  let caseBlock = `PATIENT CASE:\n${patientCase}`;
  let finalManagementCaseBlock = caseBlock;
  if (allergyInfo) {
    finalManagementCaseBlock += `\n\nCRITICAL SAFETY WARNING: Patient is allergic to ${allergyInfo.allergy.toUpperCase()}. DO NOT prescribe or recommend any of the following medications: ${allergyInfo.warnings.join(", ")}. If these drugs would normally be indicated, you MUST specify a safe alternative class of drug and clearly document the reason for the substitution.`;
  }

  // ── PHASE 1: Triage + Management in PARALLEL ──
  yield { type: "status", agent: "triage", agentName: "TriageAgent", message: "TriageAgent is working…" };
  yield {
    type: "status",
    agent: "management",
    agentName: "ManagementAgent",
    message: "ManagementAgent searching PubMed + guidelines…",
  };

  const evidencePromise = Promise.all([
    gatherEvidence(patientCase + " emergency management guidelines"),
    trustedMedicalSearch(patientCase + " management guideline"),
  ]).then(([pubmed, web]) => `\n\n---\n\nPUBMED EVIDENCE:\n${pubmed}\n\nTRUSTED GUIDELINES:\n${web}`);

  const triagePromise = runAgent("triage", caseBlock, "investigation", roomId);
  const managementPromise = evidencePromise.then((evidence) =>
    runAgent("management", finalManagementCaseBlock + evidence, "investigation", roomId)
  );

  const results = await Promise.allSettled([triagePromise, managementPromise]);

  let triageStep: CascadeStep | null = null;
  let managementStep: CascadeStep | null = null;

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

  if (!triageStep && !managementStep) return;

  // ── HUMAN-IN-THE-LOOP PAUSE POINT ──
  yield {
    type: "pause",
    runId,
    message: "Triage and Initial Management Plan ready for clinician verification.",
  };

  const resumePromise = new Promise<ResumeData>((resolve) => {
    pendingRuns.set(runId, { resolve });
  });

  const resumeData = await resumePromise;
  pendingRuns.delete(runId);

  let triageContent = triageStep?.content || "";
  let managementContent = managementStep?.content || "";

  if (resumeData.approved) {
    if (resumeData.atsOverride) {
      const waitTimes = [0, 0, 10, 30, 60, 120];
      triageContent = `TRIAGE: ATS ${resumeData.atsOverride} | Clinician Overridden | Max wait: ${waitTimes[resumeData.atsOverride]} minutes\n**SUMMARY:** [Clinician Overridden] Case prioritisation verified and adjusted by doctor.`;
      if (triageStep) {
        triageStep.content = triageContent;
        yield { type: "step", agent: "triage", agentName: "TriageAgent", step: triageStep };
      }
    }
  }

  const transcript: string[] = [caseBlock];
  if (triageContent) transcript.push(`TriageAgent OUTPUT:\n${triageContent}`);
  if (managementContent) transcript.push(`ManagementAgent OUTPUT:\n${managementContent}`);
  if (resumeData.approved && resumeData.note) {
    transcript.push(`CLINICIAN INPUT:\n${resumeData.note}`);
  }

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
  let investigationStep = await runAgent("investigation", compileTranscriptFor("investigation"), "documentation", roomId);
  investigationContent = investigationStep.content;
  yield { type: "step", agent: "investigation", agentName: "InvestigationAgent", step: investigationStep };

  yield { type: "status", agent: "documentation", agentName: "DocumentationAgent", message: "DocumentationAgent is working…" };
  countStep();
  let documentationStep = await runAgent("documentation", compileTranscriptFor("documentation"), "observer", roomId);
  documentationContent = documentationStep.content;
  yield { type: "step", agent: "documentation", agentName: "DocumentationAgent", step: documentationStep };

  // ── PHASE 3: Audit + Self-Correction Loop ──
  const retriedAgents = new Set<AgentId>();
  let observerStep: CascadeStep | null = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    yield { type: "status", agent: "observer", agentName: "ObserverAgent", message: `ObserverAgent auditing (Attempt ${attempt})…` };
    countStep();
    observerStep = await runAgent("observer", compileTranscriptFor("observer"), null, roomId);
    observerContent = observerStep.content;
    yield { type: "step", agent: "observer", agentName: "ObserverAgent", step: observerStep };

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
      triageStep = await runAgent("triage", caseBlock + correctionCritique, "investigation", roomId, 0.45);
      triageContent = triageStep.content;
      yield { type: "step", agent: "triage", agentName: "TriageAgent", step: triageStep };
    } else if (agentToRetry === "management") {
      yield { type: "status", agent: "management", agentName: "ManagementAgent", message: "Retrying ManagementAgent with feedback…" };
      managementStep = await runAgent("management", finalManagementCaseBlock + (await evidencePromise) + correctionCritique, "investigation", roomId, 0.45);
      managementContent = managementStep.content;
      yield { type: "step", agent: "management", agentName: "ManagementAgent", step: managementStep };
    } else if (agentToRetry === "investigation") {
      yield { type: "status", agent: "investigation", agentName: "InvestigationAgent", message: "Retrying InvestigationAgent with feedback…" };
      investigationStep = await runAgent("investigation", compileTranscriptFor("investigation") + correctionCritique, "documentation", roomId, 0.45);
      investigationContent = investigationStep.content;
      yield { type: "step", agent: "investigation", agentName: "InvestigationAgent", step: investigationStep };
    } else if (agentToRetry === "documentation") {
      yield { type: "status", agent: "documentation", agentName: "DocumentationAgent", message: "Retrying DocumentationAgent with feedback…" };
      documentationStep = await runAgent("documentation", compileTranscriptFor("documentation") + correctionCritique, "observer", roomId, 0.45);
      documentationContent = documentationStep.content;
      yield { type: "step", agent: "documentation", agentName: "DocumentationAgent", step: documentationStep };
    }

    // Re-run downstream dependents
    if (agentToRetry === "triage" || agentToRetry === "management") {
      yield { type: "status", agent: "investigation", agentName: "InvestigationAgent", message: "Re-running InvestigationAgent downstream…" };
      investigationStep = await runAgent("investigation", compileTranscriptFor("investigation"), "documentation", roomId);
      investigationContent = investigationStep.content;
      yield { type: "step", agent: "investigation", agentName: "InvestigationAgent", step: investigationStep };
    }

    if (agentToRetry === "triage" || agentToRetry === "management" || agentToRetry === "investigation") {
      yield { type: "status", agent: "documentation", agentName: "DocumentationAgent", message: "Re-running DocumentationAgent downstream…" };
      documentationStep = await runAgent("documentation", compileTranscriptFor("documentation"), "observer", roomId);
      documentationContent = documentationStep.content;
      yield { type: "step", agent: "documentation", agentName: "DocumentationAgent", step: documentationStep };
    }
  }

  yield { type: "done" };
}
