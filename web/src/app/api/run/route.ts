// POST /api/run  { case: string }
// Streams the cascade as Server-Sent Events so the UI updates live per agent.

import { runCascade } from "@/lib/orchestrator";

export const runtime = "nodejs";
export const maxDuration = 300; // allow the full cascade (Vercel Pro) / no-op locally

export async function POST(req: Request) {
  let patientCase = "";
  let newRoom = false;
  try {
    const body = await req.json();
    patientCase = (body?.case || "").toString().trim();
    newRoom = Boolean(body?.newRoom);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  if (!patientCase) {
    return new Response("Missing 'case'", { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      try {
        for await (const ev of runCascade(patientCase, { newRoom })) {
          send(ev);
        }
      } catch (err) {
        send({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
