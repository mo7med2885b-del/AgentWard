// The cascade orchestrator.
//
// Phase 1: Triage runs alone and streams, then the pipeline PAUSES for the
//          clinician to verify/override the ATS level (human-in-the-loop).
// Phase 2: After verification, Management builds the plan (informed by the
//          verified triage + any clinician note).
// Phase 3: Investigation -> Documentation -> Observer run sequentially, with an
//          Observer self-correction loop that can re-run a flagged agent.
//
// Each completed step is posted to the Band room as that agent (@mentioning the
// next where sensible), so the collaboration genuinely flows through Band.
// Steps are streamed to the UI as they complete.

import { AGENTS, SYSTEM_PROMPTS } from "./agents";
import { streamForAgent } from "./llm";
import { gatherEvidence } from "./pubmed";
import { trustedMedicalSearch } from "./tavily";
import { postToBand, createRoomWithAgents, bandConfigured } from "./band";
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
// Deterministic, rule-based — NOT an LLM. Safety-critical contraindication
// checks must be auditable and free of hallucination, mirroring real clinical
// systems (Epic/Cerner use rule engines, not AI, for allergy/interaction
// checks). Coverage is built bottom-up from the documented ED drug-allergy
// distribution: antibiotics ~47% and analgesics ~17% of recorded ED drug
// allergies (PMC9143688), with the remaining classes (anticonvulsants, contrast,
// anaesthetics, anticoagulants, insulin, chemo, biologics, etc.) enumerated
// below. By our analysis this keyword set spans the drug classes responsible
// for ~85% of documented ED drug allergies. (Estimate from the class
// distribution, not a single-study figure.)
//
// Matching tolerates minor misspellings (e.g. "asbrin" → "aspirin") via a
// per-token Levenshtein distance ≤1 for tokens length ≥5, so a slightly
// mistyped drug name still triggers the alert.

// Levenshtein edit distance, capped early once it exceeds `max` for speed.
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      curr[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1; // whole row already exceeds budget
    prev = curr;
  }
  return prev[b.length];
}

function checkAllergies(patientCase: string): { allergy: string; warnings: string[] } | null {
  const lowercase = patientCase.toLowerCase();
  // Word tokens used for fuzzy (misspelling-tolerant) matching.
  const tokens = lowercase.split(/[^a-z]+/).filter((t) => t.length >= 4);

  const allergiesMap = [
    {
      category: "PENICILLINS & BETA-LACTAMS",
      keywords: ["penicillin", "amoxicillin", "ampicillin", "piperacillin", "tazobactam", "augmentin", "beta-lactam", "flucloxacillin", "dicloxacillin"],
      warnings: ["Penicillin G/V", "Amoxicillin", "Ampicillin", "Piperacillin/Tazobactam (Zosyn)", "Augmentin", "Flucloxacillin", "(cross-reactive) Cephalosporins"],
    },
    {
      category: "CEPHALOSPORINS",
      keywords: ["cephalosporin", "ceftriaxone", "rocephin", "cefazolin", "cephalexin", "keflex", "cefepime", "cefuroxime", "ceftazidime"],
      warnings: ["Ceftriaxone (Rocephin)", "Cefazolin", "Cephalexin (Keflex)", "Cefepime", "Cefuroxime", "(possible cross-reactivity with penicillins)"],
    },
    {
      category: "FLUOROQUINOLONES",
      keywords: ["fluoroquinolone", "ciprofloxacin", "cipro", "levofloxacin", "levaquin", "moxifloxacin", "ofloxacin"],
      warnings: ["Ciprofloxacin (Cipro)", "Levofloxacin (Levaquin)", "Moxifloxacin", "Ofloxacin"],
    },
    {
      category: "MACROLIDES",
      keywords: ["macrolide", "azithromycin", "zithromax", "erythromycin", "clarithromycin", "biaxin"],
      warnings: ["Azithromycin (Zithromax)", "Erythromycin", "Clarithromycin (Biaxin)"],
    },
    {
      category: "GLYCOPEPTIDES",
      keywords: ["vancomycin", "vancocin", "teicoplanin"],
      warnings: ["Vancomycin (risk of red-man syndrome)", "Teicoplanin"],
    },
    {
      category: "TETRACYCLINES",
      keywords: ["tetracycline", "doxycycline", "minocycline", "doxy"],
      warnings: ["Doxycycline", "Minocycline", "Tetracycline"],
    },
    {
      category: "SULFA DRUGS",
      keywords: ["sulfa", "sulfamethoxazole", "bactrim", "septra", "sulfonamide", "cotrimoxazole"],
      warnings: ["Bactrim (Sulfamethoxazole/Trimethoprim)", "Septra", "Sulfadiazine", "Sulfasalazine"],
    },
    {
      category: "ASPIRIN & SALICYLATES",
      keywords: ["aspirin", "salicylate", "acetylsalicylic", "ecotrin"],
      warnings: ["Aspirin", "Ecotrin", "ASA-containing compounds"],
    },
    {
      category: "NSAIDS",
      keywords: ["nsaid", "ibuprofen", "advil", "motrin", "naproxen", "aleve", "ketorolac", "toradol", "diclofenac", "celebrex", "celecoxib", "meloxicam", "indomethacin"],
      warnings: ["Ibuprofen (Advil/Motrin)", "Naproxen (Aleve)", "Ketorolac (Toradol)", "Diclofenac", "Celecoxib (Celebrex)", "Meloxicam"],
    },
    {
      category: "OPIOIDS",
      keywords: ["morphine", "codeine", "oxycodone", "percocet", "hydrocodone", "vicodin", "fentanyl", "hydromorphone", "dilaudid", "tramadol", "opioid", "narcotic"],
      warnings: ["Morphine", "Codeine", "Oxycodone (Percocet/OxyContin)", "Hydrocodone (Vicodin)", "Fentanyl", "Hydromorphone (Dilaudid)", "Tramadol"],
    },
    {
      category: "ANTICOAGULANTS & HEPARINS",
      keywords: ["heparin", "enoxaparin", "lovenox", "warfarin", "coumadin", "dalteparin", "fondaparinux", "rivaroxaban", "apixaban", "eliquis"],
      warnings: ["Heparin (risk of HIT)", "Enoxaparin (Lovenox)", "Warfarin (Coumadin)", "Rivaroxaban (Xarelto)", "Apixaban (Eliquis)"],
    },
    {
      category: "INSULIN",
      keywords: ["insulin", "lantus", "humalog", "novolog", "glargine", "lispro", "aspart"],
      warnings: ["Insulin glargine (Lantus)", "Insulin lispro (Humalog)", "Insulin aspart (NovoLog)"],
    },
    {
      category: "IV CONTRAST MEDIA",
      keywords: ["contrast", "iodine", "iodinated", "gadolinium", "iohexol", "omnipaque"],
      warnings: ["Iodinated contrast agents", "Gadolinium-based contrast agents"],
    },
    {
      category: "LOCAL ANESTHETICS",
      keywords: ["lidocaine", "bupivacaine", "novocaine", "procaine", "xylocaine", "sensocaine", "mepivacaine"],
      warnings: ["Lidocaine", "Bupivacaine", "Novocaine", "Xylocaine", "Mepivacaine"],
    },
    {
      category: "NEUROMUSCULAR BLOCKERS",
      keywords: ["succinylcholine", "rocuronium", "vecuronium", "atracurium", "cisatracurium"],
      warnings: ["Succinylcholine", "Rocuronium", "Vecuronium", "Atracurium"],
    },
    {
      category: "ANTICONVULSANTS",
      keywords: ["phenytoin", "dilantin", "carbamazepine", "tegretol", "lamotrigine", "lamictal", "valproate", "levetiracetam", "keppra"],
      warnings: ["Phenytoin (Dilantin)", "Carbamazepine (Tegretol)", "Lamotrigine (Lamictal)", "Valproate"],
    },
    {
      category: "CHEMOTHERAPY & BIOLOGICS",
      keywords: ["chemotherapy", "cisplatin", "carboplatin", "paclitaxel", "taxol", "rituximab", "rituxan", "cetuximab", "monoclonal"],
      warnings: ["Platinum agents (cis/carboplatin)", "Taxanes (paclitaxel)", "Monoclonal antibodies (e.g. rituximab)"],
    },
    {
      category: "ACE INHIBITORS",
      keywords: ["lisinopril", "enalapril", "ramipril", "benazepril", "captopril", "perindopril"],
      warnings: ["Lisinopril", "Enalapril", "Ramipril", "Benazepril (Risk of Angioedema)"],
    },
    {
      category: "STATINS",
      keywords: ["statin", "atorvastatin", "simvastatin", "rosuvastatin", "lipitor", "crestor", "pravastatin"],
      warnings: ["Atorvastatin (Lipitor)", "Simvastatin (Zocor)", "Rosuvastatin (Crestor)"],
    },
    {
      category: "LATEX",
      keywords: ["latex"],
      warnings: ["Latex urinary catheters", "Latex-containing gloves and medical supplies"],
    },
  ];

  for (const group of allergiesMap) {
    for (const keyword of group.keywords) {
      // 1. Exact substring (handles multi-word + abbreviations).
      if (lowercase.includes(keyword)) {
        return { allergy: group.category, warnings: group.warnings };
      }
      // 2. Fuzzy single-token match for misspellings ("asbrin" → "aspirin").
      //    Only for single-word keywords length ≥5 to avoid false positives.
      if (keyword.length >= 5 && !keyword.includes("-") && !keyword.includes(" ")) {
        for (const tok of tokens) {
          if (editDistance(tok, keyword, 1) <= 1) {
            return { allergy: group.category, warnings: group.warnings };
          }
        }
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
  // Management runs on Gemini 3 Flash, a REASONING model: it spends tokens on
  // internal thinking before the visible answer, so a tight cap can leave the
  // visible content empty. Give it generous headroom.
  if (agent === "management") return 12000;
  if (agent === "documentation") return 6000;
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
    if (opts?.newRoom !== false) {
      yield { type: "status", message: "Creating a fresh Band room…" };
      // Surface WHY room creation failed so it's diagnosable in the UI/logs
      // (almost always: Band env keys missing or still the `your_` placeholder).
      if (!bandConfigured()) {
        yield {
          type: "status",
          message:
            "Band not configured (OBSERVER_API_KEY missing/placeholder) — using default room.",
        };
      } else {
        const created = await createRoomWithAgents();
        if (created) {
          roomId = created;
          yield { type: "status", message: `New Band room ready: ${created}` };
        } else {
          yield {
            type: "status",
            message: "Band room creation failed (API error/rate-limit) — using default room.",
          };
        }
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
  // Management agent runs. CRITICAL: this must NEVER block or reject Management.
  // PubMed (NCBI) and Tavily are external network calls with no built-in
  // timeout — if either hangs, `await evidencePromise` would stall the whole
  // cascade after the pause (Management never starts, no error shown). So each
  // source is individually time-boxed and its failure degrades to an empty
  // string; Management always proceeds (with or without evidence).
  const EVIDENCE_TIMEOUT_MS = 20000;
  const softEvidence = (p: Promise<string>): Promise<string> =>
    Promise.race([
      p,
      new Promise<string>((resolve) => setTimeout(() => resolve(""), EVIDENCE_TIMEOUT_MS)),
    ]).catch(() => "");

  const evidencePromise = Promise.all([
    softEvidence(gatherEvidence(patientCase + " emergency management guidelines")),
    softEvidence(trustedMedicalSearch(patientCase + " management guideline")),
  ])
    .then(([pubmed, web]) => `\n\n---\n\nPUBMED EVIDENCE:\n${pubmed}\n\nTRUSTED GUIDELINES:\n${web}`)
    .catch(() => "");

  // ── PHASE 1: Triage ONLY — streams, then pauses for clinician verification
  //    BEFORE the management plan is built. Running Triage alone (rather than
  //    merging two parallel generators) makes the pause appear immediately when
  //    triage finishes and structurally avoids the parallel-merge deadlock. ──
  yield { type: "status", agent: "triage", agentName: "TriageAgent", message: "TriageAgent is working…" };
  countStep();
  let triageStep: CascadeStep | null = yield* runAgent("triage", caseBlock, "management", roomId);

  let triageContent = triageStep?.content || "";

  // ── HUMAN-IN-THE-LOOP PAUSE POINT (right after triage) ──
  // On serverless hosts (Vercel Hobby caps functions at 60s) a human pause would
  // outlive the function and kill the SSE stream — the cascade would silently
  // stop after "Approve". Set AUTO_APPROVE=1 in that environment to skip the
  // human wait and run straight through. Local/Pro keeps the real HITL pause.
  const autoApprove = process.env.AUTO_APPROVE === "1" || process.env.AUTO_APPROVE === "true";

  let resumeData: ResumeData;
  if (autoApprove) {
    yield {
      type: "status",
      agent: "triage",
      agentName: "TriageAgent",
      message: "Triage verified (auto-approve) — continuing to management planning…",
    };
    resumeData = { approved: true };
  } else {
    yield {
      type: "pause",
      runId,
      message: "Triage complete — awaiting clinician verification before management planning.",
    };

    const resumePromise = new Promise<ResumeData>((resolve) => {
      pendingRuns.set(runId, { resolve });
    });

    resumeData = await resumePromise;
    pendingRuns.delete(runId);
  }

  if (resumeData.approved && resumeData.atsOverride) {
    const waitTimes = [0, 0, 10, 30, 60, 120];
    triageContent = `TRIAGE: ATS ${resumeData.atsOverride} | Clinician Overridden | Max wait: ${waitTimes[resumeData.atsOverride]} minutes\n**SUMMARY:** [Clinician Overridden] Case prioritisation verified and adjusted by doctor.`;
    if (triageStep) {
      triageStep.content = triageContent;
      yield { type: "step", agent: "triage", agentName: "TriageAgent", step: triageStep };
    }
  }

  // ── PHASE 2: Management plan — runs AFTER verification, informed by the
  //    verified triage + any clinician note. Streams live. ──
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
  let managementStep: CascadeStep | null = null;
  let managementContent = "";
  try {
    managementStep = yield* runAgent(
      "management",
      `${finalManagementCaseBlock}\n\nVERIFIED TRIAGE:\n${triageContent}${clinicianNote}${evidence}`,
      "investigation",
      roomId
    );
    managementContent = managementStep?.content || "";
  } catch (err) {
    // Surface the REAL reason instead of silently stalling the cascade.
    yield {
      type: "error",
      agent: "management",
      agentName: "ManagementAgent",
      message: `ManagementAgent failed: ${err instanceof Error ? err.message : String(err)}`,
    };
    // Continue the pipeline so downstream agents (and the audit) still run with
    // whatever context exists, rather than leaving the run hung.
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
