<div align="center">

# AgentWard

**An advanced, self-correcting clinical command console where five specialist AI agents triage, plan, investigate, document, and audit cases — coordinated live over [Band](https://band.ai).**

Built for the **Band of Agents Hackathon** · Track 3 — Regulated & High-Stakes Workflows (Healthcare coordination)

</div>

---

## 🚀 Overview

In a fast-paced emergency department, a single case touches triage, care planning, diagnostics, documentation, and quality assurance. Normally, this involves complex handoffs that lose context.

**AgentWard** automates and safeguards this workflow by dividing roles among **five specialized agents** that communicate through the Band SDK. It introduces robust clinical safety nets: a **hard allergy safety checker**, an **interactive Human-in-the-Loop (HITL) verification step**, and a **self-correcting Observer audit loop** that regenerates failed agent outputs on the fly.

---

## 🛠️ The Agent Grid

| Agent | Role / Responsibility | Model | Provider |
|-------|-----------------------|-------|----------|
| **Triage** | Assigns Australasian Triage Scale (ATS 1–5) and logs reasoning | `anthropic/claude-sonnet-4.6` | **OpenRouter** |
| **Management** | Evidence-based initial care plan (PubMed + Tavily whitelisted guidelines) | `deepseek-ai/DeepSeek-V4-Flash` → `google/gemini-3-flash-preview` (fallback) | **Featherless** → **OpenRouter** |
| **Investigation** | Prioritised diagnostic labs, imaging, and bedside diagnostics | `mistralai/Mistral-Small-24B-Instruct` | **Featherless** |
| **Documentation** | Compiles case facts into a structured, standard EHR clinical note | `Qwen/Qwen2.5-32B-Instruct` | **Featherless** |
| **Observer (Audit)** | Audits every agent output against its clinical contract | `mistralai/Mistral-Small-24B-Instruct` | **Featherless** |

### Optimized Model Routing

We use [Featherless AI](https://featherless.ai) serverless inference to host open-source models optimized for latency, budget, and instruction-following:
- **Triage** runs on **Claude Sonnet 4.6** via OpenRouter to keep it off the Featherless concurrency budget, allowing Triage and Management planning to run in parallel without hitting limits.
- **Management** runs on **DeepSeek-V4-Flash** for fast, high-quality structured care-plan formulation, with **Gemini 3 Flash** (OpenRouter) as an automatic second-layer fallback and **Qwen2.5-32B** as a final safety net — so a plan is always produced even if a provider is unavailable.
- **Investigation** and **Observer** run **Mistral-Small-24B** for fast instruction following and reliable auditing.
- **Documentation** runs **Qwen2.5-32B-Instruct** for detailed, standard-compliant EHR clinical summaries.

---

## 🔒 Reliability & Safety Guardrails

To ensure safety in a high-stakes clinical environment, AgentWard incorporates three primary guardrails:

### 1. Hard Allergy Safety Checker
Before planning begins, the backend scans the patient case against **20 critical drug classes** — Penicillins/Beta-lactams, Cephalosporins, Fluoroquinolones, Macrolides, Glycopeptides (Vancomycin), Tetracyclines, Sulfa, Aspirin/Salicylates, NSAIDs, Opioids, Anticoagulants/Heparins, Insulin, IV Contrast, Local Anaesthetics, Neuromuscular Blockers, Anticonvulsants, Chemotherapy/Biologics, ACE Inhibitors, Statins, and Latex.

This is **deliberately rule-based, not an LLM** — safety-critical contraindication checks must be deterministic and auditable (the same approach real EHRs like Epic/Cerner use), with zero hallucination risk. Coverage is derived from the documented ED drug-allergy distribution: antibiotics (~47%) and analgesics (~17%) account for the majority of recorded ED drug allergies ([systematic review, PMC9143688](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9143688/)). By enumerating these plus the remaining named classes, **this checker covers the drug classes responsible for ~85% of documented ED drug allergies** (estimate derived from the class distribution, not a single-study figure).

Matching is **misspelling-tolerant** — a per-token Levenshtein distance of ≤1 means a mistyped drug name (e.g. `asbrin` → `aspirin`) still triggers the alert. If an allergy is found:
- A `safety_alert` is streamed immediately to display a warning bar in the UI.
- Strict substitution constraints are injected into the Management Agent's system prompt, ensuring contraindicated medications are never recommended.

> Roadmap: back this with a structured drug-interaction database (RxNorm / First Databank) for full formulary coverage — still deterministic, never an LLM.

### 2. Human-in-the-Loop (HITL) Checkpoint
The pipeline surfaces a clinician verification step **after Triage and before the Management plan is built**. Clinicians review the assigned ATS level, override it (ATS 1-5), add vital details or clinical notes, and click **Approve** before the cascade continues.

On a long-lived server the backend yields a real `pause` event and waits for the clinician's resume. On stateless serverless hosts (e.g. Vercel), where a function cannot hold an open stream while waiting for a human, the cascade runs straight through (`AUTO_APPROVE`) while the verification overlay is presented client-side — so the checkpoint stays in the workflow without a broken cross-instance wait.

### 3. Self-Correction Audit Loop
The **Observer Agent** audits the whole cascade and can send **any** of the four upstream agents (Triage, Management, Investigation, or Documentation) back to reprocess. Rather than a brittle word-match on its report, the Observer makes a single explicit decision — it ends its audit with a machine-readable directive (`MENTION: <Agent|NONE> — reason`) naming the one agent whose work has a genuine, care-affecting defect, or `NONE` when everything passes.

The Observer then **posts its audit into the shared Band room, `@mentioning` that agent** — exactly like the other handoffs — and the orchestrator routes the retry from that same mention. The flagged agent is re-run with the Observer's critique injected, followed by every **downstream** agent that depended on it so the final note stays consistent. Because the supervisor's decision and the correction are real Band messages, the Observer-to-agent conversation is visible live in the Band chat — genuine agent-to-agent collaboration, not a silent local retry. When the audit passes clean, the Observer mentions `NONE` and the cascade finishes without re-running anything.

---

## 📚 Verified Evidence Only

The Management Agent never searches the open web. Its evidence comes from two restricted, medically verified sources:

- **PubMed** via the **NCBI E-utilities API** (ESearch → ESummary → EFetch) — peer-reviewed biomedical literature, cited by real PMID with clickable links.
- **Tavily web search restricted to a strict whitelist** of **50+ authoritative, medically verified organisations and guideline bodies**. The query **cannot return results from anywhere else** — only from recognised clinical authorities spanning public-health agencies (**WHO, NICE, CDC, NIH, USPSTF**), evidence libraries (**Cochrane, BMJ, JAMA, The Lancet, NEJM, UpToDate**), and specialty colleges across every major field — cardiology (**ACC/AHA, ESC**), infectious disease (**IDSA**), oncology (**NCCN, ASCO**), emergency medicine (**ACEP**), critical care (**SCCM**), neurology/neurosurgery (**AAN, AANS**), surgery (**ACS, AAOS**), respiratory (**ATS, CHEST, GOLD, GINA**), nephrology (**KDIGO**), endocrinology (**Endocrine Society, ADA**), OB/GYN (**ACOG, RCOG, RANZCOG**), pediatrics (**AAP, AACAP**), psychiatry (**APA**), dermatology (**AAD**), rheumatology (**ACR-rheum**), urology (**AUA**), hepatology (**AASLD**), hematology (**ASH**), radiology (**ACR**), and more. (See [`web/src/lib/tavily.ts`](web/src/lib/tavily.ts) for the full `include_domains` list.)

This `include_domains` constraint eliminates general-web hallucination and blocks consumer/blog/news sources, so every cited guideline traces back to a recognised clinical authority.

---

## 🌐 Live Coordination over Band

Band is the central message bus. For every phase, the active agent posts its output to a shared Band room using its own agent key, `@mentioning` the next agent in the chain.
- A **fresh Band room is generated per case** by the Observer agent.
- All live agent communications are mirrored in real-time in the Band UI.

```
            +---------- Run in Parallel ------------+
 Patient -->|  Triage (OpenRouter)   Management(FL) |
            +------------------+--------------------+
                               |  (Both post to Band)
                         Investigation (FL)
                               |
                         Documentation (FL)
                               |
                         Observer / Audit (FL)
```

---

## 💻 Tech Stack

- **Framework**: Next.js 14 (App Router) + React + TypeScript
- **Styling**: Tailwind CSS + Framer Motion (for real-time streaming animations)
- **Agent Protocol**: Band Agent SDK
- **LLM API**: Featherless AI + OpenRouter
- **Evidence Search**: NCBI E-utilities (PubMed) + Tavily API

---

## 🚀 Quick Start (Running Locally)

1. Clone the repository and navigate to the web directory:
   ```bash
   cd web
   npm install
   ```
2. Create your local environment file:
   ```bash
   cp .env.local.example .env.local
   ```
3. Fill in the required API keys inside `.env.local`: **Featherless**, **OpenRouter** (for Triage), **NCBI** (PubMed), **Tavily**, and the **5 Band agent credentials** (API key + UUID + handle for Triage, Management, Investigation, Documentation, Observer). All variables are documented in [`web/.env.local.example`](web/.env.local.example).
4. Run the development server:
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) to view the console.
