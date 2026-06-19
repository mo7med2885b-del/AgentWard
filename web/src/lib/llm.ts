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
  // Optional second-layer model tried before the global FALLBACK if this route
  // fails. Used so Management runs on DeepSeek-V4-Flash first, then Gemini.
  secondary?: ModelRoute;
}

// Cheap, always-on Featherless fallback when a primary model is unavailable.
const FALLBACK: ModelRoute = { provider: "featherless", model: "Qwen/Qwen2.5-32B-Instruct" };

// Per-agent routing, tiered by role/benchmark:
//   triage         -> OpenRouter (Claude Sonnet 4.6) — MUST stay off Featherless
//                     so Triage + Management run in PARALLEL without blowing
//                     Featherless's 4-unit concurrency cap (429s otherwise).
//   management     -> DeepSeek-V4-Flash, then Gemini 3 Flash as a second layer
//   investigation  -> light/fast capable model (Mistral-Small-24B)
//   documentation  -> reliable, clean-formatting model (Qwen2.5-32B)
//   observer/audit -> fast validation model (Mistral-Small-24B)
export const AGENT_ROUTES: Record<AgentId, ModelRoute> = {
  triage: { provider: "openrouter", model: "anthropic/claude-sonnet-4.6" },
  // Management runs on DeepSeek-V4-Flash (Featherless) as the primary care-plan
  // model, with Gemini 3 Flash (OpenRouter) as a second layer if DeepSeek fails,
  // and the global Qwen FALLBACK as the final safety net.
  management: {
    provider: "featherless",
    model: "deepseek-ai/DeepSeek-V4-Flash",
    secondary: { provider: "openrouter", model: "google/gemini-3-flash-preview" },
  },
  investigation: { provider: "featherless", model: "mistralai/Mistral-Small-24B-Instruct-2501" },
  documentation: { provider: "featherless", model: "Qwen/Qwen2.5-32B-Instruct" },
  observer: { provider: "featherless", model: "mistralai/Mistral-Small-24B-Instruct-2501" },
};

export interface LlmResult {
  content: string;
  provider: string;
}

// Ordered list of models to try for an agent: primary → its optional secondary
// (second layer) → the global FALLBACK. Duplicates and the FALLBACK-equals-primary
// case are de-duped so we never call the same model twice in a row.
function buildAttempts(primary: ModelRoute): ModelRoute[] {
  const chain: ModelRoute[] = [{ provider: primary.provider, model: primary.model }];
  if (primary.secondary) chain.push(primary.secondary);
  chain.push(FALLBACK);
  const seen = new Set<string>();
  return chain.filter((r) => {
    const key = `${r.provider}:${r.model}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
 * Streaming single call. Invokes onToken for each text delta and returns the
 * full accumulated content. Throws on transport/HTTP error so the caller can
 * fall back.
 */
async function callOnceStream(
  route: ModelRoute,
  system: string,
  user: string,
  onToken: (delta: string) => void,
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
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: opts?.temperature ?? 0.2,
      max_tokens: opts?.maxTokens ?? 1600,
      stream: true,
    }),
  });
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    throw new Error(`${route.provider} ${res.status}: ${body.slice(0, 180)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  // Parse the OpenAI-style SSE chunk stream: lines of "data: {json}".
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const json = JSON.parse(payload);
        const delta: string = json?.choices?.[0]?.delta?.content ?? "";
        if (delta) {
          full += delta;
          onToken(delta);
        }
      } catch {
        // Partial JSON across chunk boundary — push back and wait for more.
        buffer = line + "\n" + buffer;
        break;
      }
    }
  }

  if (!full.trim()) throw new Error(`${route.provider}: empty stream`);
  return full.trim();
}

/**
 * Streaming agent completion. Emits tokens via onToken as they arrive, with the
 * same single fallback as completeForAgent. Returns the full result. If the
 * primary fails MID-STREAM after emitting tokens, the fallback restarts the
 * answer — callers should treat onToken as "best effort live preview" and rely
 * on the returned content as canonical.
 */
export async function streamForAgent(
  agent: AgentId,
  system: string,
  user: string,
  onToken: (delta: string) => void,
  opts?: { temperature?: number; maxTokens?: number }
): Promise<LlmResult> {
  const attempts = buildAttempts(AGENT_ROUTES[agent]);

  let lastErr: unknown = null;
  for (let i = 0; i < attempts.length; i++) {
    const route = attempts[i];
    // 1. Try streaming first (live token preview only on the first attempt).
    try {
      const sink = i === 0 ? onToken : () => {};
      const content = await callOnceStream(route, system, user, sink, opts);
      return { content, provider: `${route.provider}:${route.model}` };
    } catch (err) {
      lastErr = err;
    }
    // 2. Stream failed (e.g. DeepSeek-V4-Flash emitting malformed delta chunks
    //    that yield empty content). Retry the SAME model non-streaming, which
    //    reads the whole message at once and sidesteps the bad-delta issue.
    try {
      const content = await callOnce(route, system, user, opts);
      return { content, provider: `${route.provider}:${route.model} (non-stream)` };
    } catch (err) {
      lastErr = err;
      continue;
    }
  }
  throw new Error(
    `All models failed (stream) for ${agent}. Last: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`
  );
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
  const attempts = buildAttempts(AGENT_ROUTES[agent]);

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
