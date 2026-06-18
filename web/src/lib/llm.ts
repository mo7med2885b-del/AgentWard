// LLM client — per-agent provider + model routing with safe fallback.
//
// Triage runs on OpenRouter (Claude Sonnet 4.6) so it does NOT consume the
// Featherless concurrency budget — letting Triage + Management run in parallel
// without hitting Featherless's 4-unit cap. The other four agents run on
// Featherless with benchmark-tiered models. Any failure falls back ONCE to a
// cheap reliable Featherless model so the demo never dies.

import type { AgentId } from "./types";

type ProviderName = "featherless" | "openrouter";

interface ProviderCfg {
  baseUrl: string;
  apiKey: string | undefined;
  extraHeaders?: Record<string, string>;
}

function providerCfg(name: ProviderName): ProviderCfg {
  if (name === "openrouter") {
    return {
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: process.env.OPENROUTER_API_KEY,
      extraHeaders: {
        "HTTP-Referer": "https://agentward.app",
        "X-Title": "AgentWard",
      },
    };
  }
  return {
    baseUrl: "https://api.featherless.ai/v1",
    apiKey: process.env.FEATHERLESS_API_KEY,
  };
}

interface ModelRoute {
  provider: ProviderName;
  model: string;
}

// Cheap, always-on Featherless fallback when a primary model is unavailable.
const FALLBACK: ModelRoute = { provider: "featherless", model: "Qwen/Qwen2.5-32B-Instruct" };

// Per-agent routing, tiered by role/benchmark:
//   triage         -> OpenRouter Claude Sonnet 4.6 (off Featherless budget)
//   management     -> high-benchmark fast model (DeepSeek-V4-Flash)
//   investigation  -> light/fast capable model (Mistral-Small-24B)
//   documentation  -> reliable, clean-formatting model (Qwen2.5-32B)
//   observer/audit -> dedicated reasoning model (Qwen3-235B Thinking)
export const AGENT_ROUTES: Record<AgentId, ModelRoute> = {
  triage: { provider: "openrouter", model: "anthropic/claude-sonnet-4.6" },
  management: { provider: "featherless", model: "deepseek-ai/DeepSeek-V4-Flash" },
  investigation: { provider: "featherless", model: "mistralai/Mistral-Small-24B-Instruct-2501" },
  documentation: { provider: "featherless", model: "Qwen/Qwen2.5-32B-Instruct" },
  observer: { provider: "featherless", model: "Qwen/Qwen3-235B-A22B-Thinking-2507" },
};

export interface LlmResult {
  content: string;
  provider: string;
}

async function callOnce(
  route: ModelRoute,
  system: string,
  user: string,
  opts?: { temperature?: number; maxTokens?: number }
): Promise<string> {
  const cfg = providerCfg(route.provider);
  if (!cfg.apiKey || cfg.apiKey.includes("your_")) {
    throw new Error(`${route.provider}: API key not configured`);
  }
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
      ...(cfg.extraHeaders || {}),
    },
    body: JSON.stringify({
      model: route.model,
      // Strictly the system prompt + the user content — nothing else.
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: opts?.temperature ?? 0.2,
      max_tokens: opts?.maxTokens ?? 1600,
      stream: false,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${route.provider} ${res.status}: ${body.slice(0, 180)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error(`${route.provider}: empty response`);
  return content;
}

/**
 * Run an agent's LLM call using its assigned provider+model, falling back ONCE
 * to a cheap reliable Featherless model if the primary is unavailable.
 */
export async function completeForAgent(
  agent: AgentId,
  system: string,
  user: string,
  opts?: { temperature?: number; maxTokens?: number }
): Promise<LlmResult> {
  const primary = AGENT_ROUTES[agent];
  const attempts: ModelRoute[] =
    primary.provider === FALLBACK.provider && primary.model === FALLBACK.model
      ? [primary]
      : [primary, FALLBACK];

  let lastErr: unknown = null;
  for (const route of attempts) {
    try {
      const content = await callOnce(route, system, user, opts);
      return { content, provider: `${route.provider}:${route.model}` };
    } catch (err) {
      lastErr = err;
      continue;
    }
  }
  throw new Error(
    `All models failed for ${agent}. Last: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`
  );
}
