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
The **Observer Agent** audits downstream outputs. If it detects a contract breach (e.g., Management missing PubMed PMIDs or guidelines), it flags the agent (e.g., `[!] Management`). The orchestrator catches the flag, triggers an inline retry passing the critique back to the agent, and updates all downstream dependent logs.

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
3. Fill in the required API keys inside `.env.local` (Featherless, OpenRouter, NCBI, Tavily, and the 5 Band agent credentials).
4. Run the development server:
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) to view the console.

---

## ☁️ Deployment Guide

The easiest and most reliable way to host the AgentWard full-stack Next.js app (both frontend and API endpoints together) is on **Vercel**:

1. **Push your code to GitHub**: Create a repository (or push to your fork). Make sure `web/.env.local` is **never committed** (it is gitignored).
2. **Import into Vercel**: 
   - Go to [Vercel](https://vercel.com) and click **Add New > Project**.
   - Import your GitHub repository.
3. **Configure Settings**:
   - Set the **Root Directory** to `web`.
4. **Environment Variables**:
   - Copy the environment variables from your local `web/.env.local` and paste them into Vercel's **Environment Variables** UI.
5. **Deploy**: Click **Deploy**. Vercel will build your Next.js app and serve it on a secure `https` domain.

> [!WARNING]
> Since Next.js API route timeouts on Vercel's hobby plan are limited to 10 seconds, make sure your models respond quickly or upgrade to a Pro plan (which extends the timeout to 5 minutes) to ensure long-running streaming cascades run without truncation.
