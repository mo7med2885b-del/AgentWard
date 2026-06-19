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
| **Management** | Evidence-based initial care plan (PubMed + Tavily whitelisted guidelines) | `deepseek-ai/DeepSeek-V4-Flash` | **Featherless** |
| **Investigation** | Prioritised diagnostic labs, imaging, and bedside diagnostics | `mistralai/Mistral-Small-24B-Instruct` | **Featherless** |
| **Documentation** | Compiles case facts into a structured, standard EHR clinical note | `Qwen/Qwen2.5-32B-Instruct` | **Featherless** |
| **Observer (Audit)** | Audits every agent output against its clinical contract | `mistralai/Mistral-Small-24B-Instruct` | **Featherless** |

### Optimized Model Routing

We use [Featherless AI](https://featherless.ai) serverless inference to host open-source models optimized for latency, budget, and instruction-following:
- **Triage** runs on **Claude Sonnet 4.6** via OpenRouter to keep it off the Featherless concurrency budget, allowing Triage and Management planning to run in parallel without hitting limits.
- **Management** utilizes **DeepSeek-V4-Flash** for high-speed, structured care plan formulation.
- **Investigation** and **Observer** run **Mistral-Small-24B** for fast instruction following and reliable auditing.
- **Documentation** runs **Qwen2.5-32B-Instruct** for detailed, standard-compliant EHR clinical summaries.

---

## 🔒 Reliability & Safety Guardrails

To ensure safety in a high-stakes clinical environment, AgentWard incorporates three primary guardrails:

### 1. Hard Allergy Safety Checker
Before planning begins, the backend scans the patient case for 11 critical drug classes (Penicillins, NSAIDs, Opioids, Sulfa, ACE Inhibitors, Contrast, Latex, etc.). If an allergy is found:
- A `safety_alert` is streamed immediately to display a warning bar in the UI.
- Strict substitution constraints are injected into the Management Agent's system prompt, ensuring contraindicated medications are never recommended.

### 2. Human-in-the-Loop (HITL) Checkpoint
The pipeline pauses after Phase 1 (Triage + Care Plan) and yields a `pause` event. Clinicians can review the assigned ATS level, override it (ATS 1-5), input additional vital details or clinical notes, and click **Approve** to resume the live cascade.

### 3. Self-Correction Audit Loop
The **Observer Agent** audits the whole cascade and can send **any** of the four upstream agents (Triage, Management, Investigation, or Documentation) back to reprocess. If it detects a contract breach — for example Management missing PubMed PMIDs, or Triage producing an invalid ATS line — it flags that agent with a `[!]` marker. The orchestrator parses the flag, re-runs the flagged agent with the Observer's critique injected, then re-runs every **downstream** agent that depended on it so the final note stays consistent. Each retry is posted back into the shared Band room, so the correction conversation between the Observer and the corrected agent is visible live in the Band chat — genuine agent-to-agent collaboration, not a silent local retry.

---

## 📚 Verified Evidence Only

The Management Agent never searches the open web. Its evidence comes from two restricted, medically verified sources:

- **PubMed** via the **NCBI E-utilities API** (ESearch → ESummary → EFetch) — peer-reviewed biomedical literature, cited by real PMID with clickable links.
- **Tavily web search restricted to a strict whitelist** of authoritative, medically verified organisations and guideline bodies. The query **cannot return results from anywhere else** — only from sources such as **WHO, NICE, CDC, NIH, USPSTF, Cochrane, BMJ, JAMA, The Lancet, NEJM, UpToDate, ACC/AHA, ESC, IDSA, ACOG, AAP, NCCN, KDIGO, GOLD, GINA, SIGN, and GIN.** (See [`web/src/lib/tavily.ts`](web/src/lib/tavily.ts) for the full `include_domains` list.)

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
