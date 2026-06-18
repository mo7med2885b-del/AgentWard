import { Console } from "@/components/Console";

export default function Home() {
  return (
    <main className="mx-auto min-h-[100dvh] max-w-[1480px] px-5 py-8 md:px-8">
      {/* Header — asymmetric, premium brand header with star mark & active protocol board */}
      <header className="mb-8 flex flex-col gap-5 border-b border-navy/10 pb-6 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2.5">
            <StarMark />
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.25em] text-navy/45">
              Agentic Medical System
            </span>
            <span className="h-1 w-1 rounded-full bg-navy/20" />
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-600 flex items-center gap-1">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
              </span>
              active protocol
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-navy">
            AgentWard Command Center
          </h1>
          <p className="mt-1 text-sm text-navy/60">
            Autonomous multi-agent clinical coordination and human-in-the-loop safety guardrails.
          </p>
        </div>

        {/* Live connected agent roster grid */}
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-navy-line bg-cream-soft/40 p-2 md:gap-3">
          <div className="flex flex-wrap gap-1.5">
            <div className="flex items-center gap-1.5 rounded-lg border border-triage/15 bg-triage/[0.04] px-2.5 py-1 text-navy">
              <span className="h-1.5 w-1.5 rounded-full bg-triage animate-pulse" />
              <div className="flex flex-col">
                <span className="font-mono text-[9px] font-medium leading-none text-navy/50">TRIAGE</span>
                <span className="font-sans text-[11px] font-semibold leading-tight text-triage">Sonnet 4.6</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 rounded-lg border border-mgmt/15 bg-mgmt/[0.04] px-2.5 py-1 text-navy">
              <span className="h-1.5 w-1.5 rounded-full bg-mgmt animate-pulse" />
              <div className="flex flex-col">
                <span className="font-mono text-[9px] font-medium leading-none text-navy/50">PLANNING</span>
                <span className="font-sans text-[11px] font-semibold leading-tight text-mgmt">DeepSeek-V4</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 rounded-lg border border-navy/15 bg-navy/[0.04] px-2.5 py-1 text-navy">
              <span className="h-1.5 w-1.5 rounded-full bg-navy animate-pulse" />
              <div className="flex flex-col">
                <span className="font-mono text-[9px] font-medium leading-none text-navy/50">TESTS</span>
                <span className="font-sans text-[11px] font-semibold leading-tight text-navy">Mistral-24B</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 rounded-lg border border-doc/15 bg-doc/[0.04] px-2.5 py-1 text-navy">
              <span className="h-1.5 w-1.5 rounded-full bg-doc animate-pulse" />
              <div className="flex flex-col">
                <span className="font-mono text-[9px] font-medium leading-none text-navy/50">EHR NOTE</span>
                <span className="font-sans text-[11px] font-semibold leading-tight text-doc">Qwen-32B</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 rounded-lg border border-observer/15 bg-observer/[0.04] px-2.5 py-1 text-navy">
              <span className="h-1.5 w-1.5 rounded-full bg-observer animate-pulse" />
              <div className="flex flex-col">
                <span className="font-mono text-[9px] font-medium leading-none text-navy/50">AUDITOR</span>
                <span className="font-sans text-[11px] font-semibold leading-tight text-observer">Mistral-24B</span>
              </div>
            </div>
          </div>
          <div className="hidden border-l border-navy/10 pl-3 md:block">
            <div className="font-mono text-[9px] font-medium leading-none text-navy/40 uppercase tracking-wider">
              platform
            </div>
            <div className="text-sm font-bold tracking-tight text-navy">Band SDK</div>
          </div>
        </div>
      </header>

      <Console />
    </main>
  );
}

function StarMark() {
  // Four-point sparkle mark matching the brand reference.
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 0c.6 6.3 5.1 10.8 11.4 11.4v1.2C17.1 13.2 12.6 17.7 12 24c-.6-6.3-5.1-10.8-11.4-11.4v-1.2C6.9 10.8 11.4 6.3 12 0Z"
        fill="#1E2A44"
      />
    </svg>
  );
}

