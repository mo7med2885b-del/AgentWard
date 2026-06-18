// Band Agent API integration — the coordination layer.
//
// Each agent in the cascade posts its output to a shared Band room using ITS
// OWN agent key, @mentioning the next agent, so the handoff genuinely flows
// THROUGH Band. A fresh room can be created per conversation so each cascade
// stays clean (no stale messages polluting context).
//
// Endpoints verified against https://app.band.ai:
//   POST /api/v1/agent/chats                         { }            -> create room
//   POST /api/v1/agent/chats/{room}/participants     { participant }
//   POST /api/v1/agent/chats/{room}/messages         { message }
//   GET  /api/v1/agent/chats/{room}/context

const BASE = "https://app.band.ai";

function envRoomId(): string {
  return (process.env.BAND_CHAT_ROOM_ID || "").trim();
}

export function bandConfigured(): boolean {
  // Band is usable as long as the observer key exists (it creates/owns rooms).
  const key = process.env.OBSERVER_API_KEY || "";
  return Boolean(key) && !key.includes("your_");
}

interface MentionTarget {
  id: string;
  handle: string;
  name: string;
}

// All five agents' Band UUIDs (for adding as participants to a new room).
const ALL_AGENT_IDS: Record<string, string | undefined> = {
  TriageAgent: process.env.TRIAGE_AGENT_ID,
  ManagementAgent: process.env.MGMT_AGENT_ID,
  InvestigationAgent: process.env.INVEST_AGENT_ID,
  DocumentationAgent: process.env.DOC_AGENT_ID,
};
const USER_BAND_ID = process.env.BAND_USER_ID; // optional: add the human owner

/**
 * Create a fresh Band room (owned by the Observer agent) and add the other
 * four agents (plus the human owner if configured). Returns the new room id,
 * or null if Band isn't configured / creation failed.
 */
export async function createRoomWithAgents(): Promise<string | null> {
  if (!bandConfigured()) return null;
  const observerKey = process.env.OBSERVER_API_KEY as string;
  try {
    const res = await fetch(`${BASE}/api/v1/agent/chats`, {
      method: "POST",
      headers: { "X-API-Key": observerKey, "Content-Type": "application/json" },
      body: JSON.stringify({ chat: {} }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const roomId: string | undefined = data?.data?.id ?? data?.id;
    if (!roomId) return null;

    // Add the other four agents as participants.
    for (const id of Object.values(ALL_AGENT_IDS)) {
      if (!id || id.includes("your_")) continue;
      await fetch(`${BASE}/api/v1/agent/chats/${roomId}/participants`, {
        method: "POST",
        headers: { "X-API-Key": observerKey, "Content-Type": "application/json" },
        body: JSON.stringify({ participant: { participant_id: id, role: "member" } }),
      }).catch(() => {});
    }
    // Add the human owner so they can watch in the Band UI.
    if (USER_BAND_ID && !USER_BAND_ID.includes("your_")) {
      await fetch(`${BASE}/api/v1/agent/chats/${roomId}/participants`, {
        method: "POST",
        headers: { "X-API-Key": observerKey, "Content-Type": "application/json" },
        body: JSON.stringify({ participant: { participant_id: USER_BAND_ID, role: "owner" } }),
      }).catch(() => {});
    }
    return roomId;
  } catch {
    return null;
  }
}

/**
 * Post an agent's message to a Band room as that agent, optionally @mentioning
 * a target. `roomId` defaults to the env room if not given. Returns true on success.
 */
export async function postToBand(
  agentApiKey: string,
  content: string,
  mention?: MentionTarget,
  roomId?: string
): Promise<boolean> {
  const room = (roomId || envRoomId()).trim();
  if (!room || !agentApiKey || agentApiKey.includes("your_")) return false;
  try {
    const res = await fetch(`${BASE}/api/v1/agent/chats/${room}/messages`, {
      method: "POST",
      headers: { "X-API-Key": agentApiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          content,
          mentions: mention
            ? [{ id: mention.id, handle: mention.handle, name: mention.name }]
            : [],
        },
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface BandMessage {
  senderName: string;
  content: string;
  at: string;
}

/** Read a room's context from an agent's perspective. */
export async function readBandContext(
  agentApiKey: string,
  roomId?: string
): Promise<BandMessage[]> {
  const room = (roomId || envRoomId()).trim();
  if (!room || !agentApiKey || agentApiKey.includes("your_")) return [];
  try {
    const res = await fetch(`${BASE}/api/v1/agent/chats/${room}/context?page_size=100`, {
      headers: { "X-API-Key": agentApiKey },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const items = data?.data ?? [];
    return items
      .filter((m: { content?: string }) => m.content)
      .map((m: { sender_name?: string; content?: string; inserted_at?: string }) => ({
        senderName: m.sender_name || "Agent",
        content: m.content || "",
        at: m.inserted_at || "",
      }));
  } catch {
    return [];
  }
}
