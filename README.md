<div align="center">

# AgentWard

**A virtual emergency board where five specialist AI agents triage, plan, investigate, document, and audit a clinical case together — coordinated live over [Band](https://band.ai).**

Built for the **Band of Agents Hackathon** · Track 3 — Regulated & High-Stakes Workflows (Healthcare coordination)

</div>

---

## The problem

In an emergency department, a single case touches triage, treatment planning, diagnostics, documentation, and quality review — normally across different people, with handoffs that lose context. A single LLM prompt collapses all those roles into one voice and hallucinates. AgentWard splits the work across **five specialised agents that hand off to each other through Band**, each with a distinct clinical contract, and a supervisor that audits the result.

## The five agents

| Agent | Role | Model | Provider |
|-------|------|-------|----------|
| **Triage** | Assigns an Australasian Triage Scale (ATS 1–5) urgency level | `claude-sonnet-4.6` | OpenRouter |
| **Management** | Evidence-based initial management plan (PubMed + trusted guidelines) | `deepseek-ai/DeepSeek-V4-Flash` | **Featherless** |
| **Investigation** | Prioritised labs / imaging / ECG workup | `mistralai/Mistral-Small-24B-Instruct-2501` | **Featherless** |
| **Documentation** | Synthesises one structured ED handover note | `Qwen/Qwen2.5-32B-Instruct` | **Featherless** |
| **Observer (Audit)** | Quality-audits every agent against its contract | `Qwen/Qwen3-235B-A22B-Thinking-2507` (reasoning) | **Featherless** |

### Why these Featherless models

We use [Featherless AI](https://featherless.ai) serverless inference for four of the five agents, picking a model per role by benchmark and latency:

- **Management → `DeepSeek-V4-Flash`** — a high-benchmark, speed-optimised model for fast, well-reasoned clinical plans.
- **Investigation → `Mistral-Small-24B`** — a light, fast 24B model, ample for structured lab/imaging selection.
- **Documentation → `Qwen2.5-32B-Instruct`** — reliable, clean instruction-following for consistent note formatting.
- **Observer → `Qwen3-235B-A22B-Thinking`** — a dedicated **reasoning** model, used deliberately for the audit step where careful verification matters most.

Featherless's single OpenAI-compatible endpoint lets us route each agent to its own open-source model without managing five integrations. Triage runs on OpenRouter (Claude Sonnet 4.6) purely to keep it off the Featherless concurrency budget so Triage and Management can run in parallel.

## How Band is the coordination layer

Band is **not** a logging mirror here — it is the bus the handoffs flow through. For each step the responsible agent **posts its output to a shared Band room using its own agent key**, `@mentioning` the next agent, and the cascade reads the room as it advances. The full conversation is visible in the Band UI exactly as the app shows it.

```
            +---------- run in parallel ------------+
 patient -->|  Triage (OpenRouter)   Management(FL) |
            +------------------+--------------------+
                               |  (both post to Band)
                         Investigation (FL)
                               |
                         Documentation (FL)
                               |
                         Observer / Audit (FL)
```

A **fresh Band room is created per conversation** (the Observer agent owns it and recruits the other four), so each case stays clean.

## Evidence

The Management agent pulls live clinical evidence before planning:

- **PubMed** via the NCBI E-utilities API (ESearch -> ESummary -> EFetch) — direct, no third-party service.
- **Trusted medical guidelines** via Tavily, restricted to a whitelist of reputable sources (NEJM, Cochrane, NICE, BMJ, WHO, CDC, UpToDate, JAMA, The Lancet, and similar).

## Reliability & safety

- **No infinite loops:** the orchestrator runs a fixed linear sequence with a global run-lock and a hard step ceiling — agents never message each other unprompted.
- **Zero-downtime model fallback:** any model failure falls back once to a cheap reliable Featherless model, so a demo never dies on a capacity blip.
- **Quality audit:** the Observer verifies each agent met its contract and reports `N/4 contracts met`.

> AgentWard is a hackathon demonstration. Outputs are AI-generated, may be inaccurate, and must not be used for real clinical decisions.

## Tech stack

- **Next.js 14** (App Router) + React + TypeScript
- **Tailwind CSS** + Framer Motion
- **Band Agent API** for multi-agent coordination
- **Featherless AI** + **OpenRouter** for inference
- **NCBI E-utilities** + **Tavily** for evidence

## Running locally

```bash
cd web
npm install
cp .env.local.example .env.local   # fill in your own keys
npm run dev                         # http://localhost:3000
```

Required environment variables are documented in [`web/.env.local.example`](web/.env.local.example): Featherless + OpenRouter keys, NCBI + Tavily keys, and the five Band agent keys/IDs.
