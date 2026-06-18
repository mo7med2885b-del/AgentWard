// POST /api/run/resume
// Receives: { runId: string, approved: boolean, atsOverride?: number, note?: string }
// Resolves the pending cascade promise to resume stream execution.

import { pendingRuns } from "@/lib/orchestrator";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { runId, approved, atsOverride, note } = body;

    if (!runId) {
      return new Response(JSON.stringify({ error: "Missing runId" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const pending = pendingRuns.get(runId);
    if (!pending) {
      return new Response(
        JSON.stringify({ error: "Run not found or already resumed" }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Resolve the promise waiting inside the runCascade generator
    pending.resolve({
      approved: Boolean(approved),
      atsOverride: atsOverride !== undefined ? Number(atsOverride) : undefined,
      note: note ? String(note).trim() : undefined,
    });

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
