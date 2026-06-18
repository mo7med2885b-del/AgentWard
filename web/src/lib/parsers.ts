// Parsers — turn raw agent markdown output into structured data the clinical
// dashboard can render as cards, checklists, gauges, and timelines.
//
// All parsers are defensive: agents are LLMs and their formatting drifts, so
// every extractor degrades gracefully (returns null / [] rather than throwing)
// and falls back to sensible heuristics when the canonical shape is missing.

import type { ActionItem, Investigation, TriageData, Vital } from "./types";

const ATS_WAIT: Record<number, number> = { 1: 0, 2: 10, 3: 30, 4: 60, 5: 120 };
const ATS_CATEGORY: Record<number, string> = {
  1: "Resuscitation",
  2: "Emergency",
  3: "Urgent",
  4: "Semi-urgent",
  5: "Non-urgent",
};
const ATS_COLOR: Record<number, TriageData["color"]> = {
  1: "RED",
  2: "ORANGE",
  3: "YELLOW",
  4: "GREEN",
  5: "WHITE",
};

/** Extract the ATS triage assessment from the TriageAgent output. */
export function parseTriage(content: string): TriageData | null {
  if (!content) return null;

  // Canonical line: "TRIAGE: ATS [N] | [Category] | Color: [COLOR] | Max wait: [X] minutes"
  // Be permissive: ATS number may be in brackets or bare.
  const atsMatch = content.match(/ATS\s*\[?\s*([1-5])\s*\]?/i);
  if (!atsMatch) return null;
  const atsLevel = Number(atsMatch[1]) as TriageData["atsLevel"];

  const waitMatch = content.match(/max\s*wait[:\s]*\[?\s*(immediate|\d+)/i);
  let maxWaitMinutes = ATS_WAIT[atsLevel];
  if (waitMatch) {
    const raw = waitMatch[1].toLowerCase();
    maxWaitMinutes = raw === "immediate" ? 0 : Number(raw);
  }

  const colorMatch = content.match(/color[:\s]*\[?\s*(RED|ORANGE|YELLOW|GREEN|WHITE)/i);
  const color = (colorMatch?.[1]?.toUpperCase() as TriageData["color"]) || ATS_COLOR[atsLevel];

  const catMatch = content.match(/ATS\s*\[?\s*[1-5]\s*\]?\s*\|\s*([A-Za-z-]+)/);
  const category = catMatch?.[1]?.trim() || ATS_CATEGORY[atsLevel];

  // Summary: prefer the **SUMMARY:** line, else first non-triage sentence.
  let summary = "";
  const sumMatch = content.match(/\*\*?summary:?\*\*?\s*(.+)/i);
  if (sumMatch) {
    summary = sumMatch[1].trim();
  } else {
    const lines = content
      .split("\n")
      .map((l) => l.replace(/[*_#]/g, "").trim())
      .filter((l) => l && !/^triage:/i.test(l) && !/^ATS\b/i.test(l));
    summary = lines[0] || "";
  }

  // Rationale: prefer the explicit **RATIONALE:** line; fall back to summary.
  const ratMatch = content.match(/\*\*?rationale:?\*\*?\s*(.+)/i);
  const rationale = ratMatch ? ratMatch[1].trim() : summary;

  return { atsLevel, category, color, maxWaitMinutes, summary, rationale };
}

/** Extract checkable "Immediate Actions" from the ManagementAgent output. */
export function parseActions(content: string): ActionItem[] {
  if (!content) return [];

  // Find the "Immediate Actions" block; if absent, fall back to the first
  // bulleted block in the whole note.
  const lower = content.toLowerCase();
  const startIdx = lower.indexOf("immediate action");
  let block = content;
  if (startIdx !== -1) {
    const after = content.slice(startIdx);
    // Stop at the next bold section header (e.g. *Monitoring:* or **...**).
    const stop = after.slice(1).search(/\n\s*\*+[A-Za-z][^*\n]*:?\*+/);
    block = stop !== -1 ? after.slice(0, stop + 1) : after;
  }

  const items: ActionItem[] = [];
  const lineRe = /^\s*[-*•]\s+(.+)$/gm;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = lineRe.exec(block)) !== null) {
    const text = m[1].replace(/\*\*/g, "").trim();
    if (!text) continue;
    items.push({ id: `action-${i++}`, text, completed: false });
  }
  return items;
}

/** Extract prioritised investigations from the InvestigationAgent output. */
export function parseInvestigations(content: string): Investigation[] {
  if (!content) return [];

  const sections: { key: Investigation["priority"]; re: RegExp }[] = [
    { key: "STAT", re: /stat\b[^\n]*/i },
    { key: "URGENT", re: /urgent\b[^\n]*/i },
    { key: "IMAGING", re: /imaging\b[^\n]*/i },
    { key: "ECG", re: /ecg\b[^\n]*/i },
  ];

  const out: Investigation[] = [];
  const lines = content.split("\n");
  let current: Investigation["priority"] | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    // Section header detection (a heading-ish line containing the keyword).
    const isHeader = /^[*_#\s]*([A-Za-z][A-Za-z\s]+)[:\-—]/.test(line) || /\*\*/.test(line);
    if (isHeader) {
      const found = sections.find((s) => s.re.test(line));
      if (found && line.replace(/[-*•]/g, "").trim().length < 60) {
        current = found.key;
        continue;
      }
    }

    // Bullet item under the current section.
    const bullet = line.match(/^[-*•]\s+(.+)$/);
    if (bullet && current) {
      const body = bullet[1].replace(/\*\*/g, "").trim();
      const [test, ...rest] = body.split(/\s+[—–-]\s+/);
      out.push({
        priority: current,
        test: test.trim(),
        rationale: rest.join(" — ").trim(),
      });
    }
  }
  return out;
}

/** Best-effort extraction of vitals from the free-text patient case. */
export function parseVitals(caseText: string): Vital[] {
  if (!caseText) return [];
  const v: Vital[] = [];

  const push = (label: string, value: string | undefined, abnormal?: boolean) => {
    if (value) v.push({ label, value: value.trim(), abnormal });
  };

  const bp = caseText.match(/\bBP[:\s]*([0-9]{2,3}\s*\/\s*[0-9]{2,3})/i);
  if (bp) {
    const sys = Number(bp[1].split("/")[0]);
    push("BP", bp[1].replace(/\s/g, "") + " mmHg", sys >= 160 || sys < 90);
  }

  const hr = caseText.match(/\bHR[:\s]*([0-9]{2,3})/i);
  if (hr) push("HR", `${hr[1]} bpm`, Number(hr[1]) > 100 || Number(hr[1]) < 50);

  const rr = caseText.match(/\bRR[:\s]*([0-9]{1,2})/i);
  if (rr) push("RR", `${rr[1]} /min`, Number(rr[1]) > 20 || Number(rr[1]) < 10);

  const spo2 = caseText.match(/SpO2[:\s]*([0-9]{2,3})\s*%?/i);
  if (spo2) push("SpO₂", `${spo2[1]}%`, Number(spo2[1]) < 94);

  const temp = caseText.match(/(?:temp|fever)[:\s]*([0-9]{2}\.?[0-9]?)\s*°?C?/i);
  if (temp) push("Temp", `${temp[1]} °C`, Number(temp[1]) >= 38 || Number(temp[1]) < 35);

  const gcs = caseText.match(/\bGCS[:\s]*([0-9]{1,2})/i);
  if (gcs) push("GCS", `${gcs[1]}/15`, Number(gcs[1]) < 15);

  return v;
}

/** Detect declared allergies and whether the plan contradicts them. */
export function detectAllergyConflict(
  caseText: string,
  managementContent: string
): { allergy: string; drug: string } | null {
  if (!caseText || !managementContent) return null;

  // Common allergy → contraindicated drug-class keywords.
  const conflicts: { allergy: RegExp; drugs: RegExp; name: string }[] = [
    { allergy: /penicillin/i, drugs: /\b(penicillin|amoxicillin|ampicillin|augmentin|piperacillin|co-amoxiclav)\b/i, name: "Penicillin" },
    { allergy: /sulfa|sulpha|sulfonamide/i, drugs: /\b(co-?trimoxazole|sulfamethoxazole|sulfasalazine)\b/i, name: "Sulfa" },
    { allergy: /aspirin|nsaid/i, drugs: /\b(aspirin|ibuprofen|naproxen|ketorolac|diclofenac)\b/i, name: "Aspirin/NSAID" },
    { allergy: /morphine|opioid|codeine/i, drugs: /\b(morphine|codeine|oxycodone|fentanyl)\b/i, name: "Opioid" },
  ];

  // Only fire if the case actually declares an allergy (not "no known allergies").
  const noAllergy = /no known allerg|nkda|no allerg/i.test(caseText);
  if (noAllergy) return null;

  for (const c of conflicts) {
    if (c.allergy.test(caseText)) {
      const drugHit = managementContent.match(c.drugs);
      if (drugHit) return { allergy: c.name, drug: drugHit[0] };
    }
  }
  return null;
}
