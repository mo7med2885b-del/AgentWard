import { Console } from "@/components/Console";

export default function Home() {
  return (
    <main className="mx-auto min-h-[100dvh] max-w-[1180px] px-5 py-8 md:px-8">
      {/* Header — asymmetric, left-aligned brand with a four-point star mark. */}
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2.5">
            <StarMark />
            <span className="font-mono text-xs uppercase tracking-[0.2em] text-navy/55">
              AgentWard
            </span>
          </div>
        </div>

        <div className="hidden shrink-0 text-right md:block">
          <div className="font-mono text-xs uppercase tracking-widest text-navy/45">
            coordinated over
          </div>
          <div className="text-lg font-semibold tracking-tight text-navy">Band</div>
        </div>
      </header>

      <Console />
    </main>
  );
}

function StarMark() {
  // Four-point sparkle mark matching the brand reference.
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 0c.6 6.3 5.1 10.8 11.4 11.4v1.2C17.1 13.2 12.6 17.7 12 24c-.6-6.3-5.1-10.8-11.4-11.4v-1.2C6.9 10.8 11.4 6.3 12 0Z"
        fill="#1E2A44"
      />
    </svg>
  );
}
