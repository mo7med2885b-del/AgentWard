// NCBI E-utilities — direct PubMed access, no third-party MCP.
// Ported from the verified Python implementation (8/8 test cases passed).
// ESearch -> top PMIDs ; ESummary -> titles ; EFetch -> abstracts.

const BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

function params(extra: Record<string, string>): string {
  const p = new URLSearchParams({
    tool: "AgentWard",
    email: "agentward@example.com",
    ...extra,
  });
  const key = process.env.NCBI_API_KEY;
  if (key && !key.includes("your_")) p.set("api_key", key);
  return p.toString();
}

export interface PubmedEvidence {
  pmid: string;
  title: string;
  journal: string;
  year: string;
  abstract: string;
}

/** Search PubMed, return the top relevance-ranked PMIDs. */
async function search(query: string, maxResults = 5): Promise<string[]> {
  const url = `${BASE}/esearch.fcgi?${params({
    db: "pubmed",
    term: query,
    retmax: String(Math.min(maxResults, 10)),
    retmode: "json",
    sort: "relevance",
  })}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  return data?.esearchresult?.idlist ?? [];
}

/** Fetch title/journal/year/abstract for one PMID via EFetch XML. */
async function fetchOne(pmid: string): Promise<PubmedEvidence | null> {
  const url = `${BASE}/efetch.fcgi?${params({
    db: "pubmed",
    id: pmid,
    rettype: "abstract",
    retmode: "xml",
  })}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const xml = await res.text();

  const pick = (re: RegExp): string => {
    const m = xml.match(re);
    return m ? m[1].replace(/<[^>]+>/g, "").trim() : "";
  };

  const title = pick(/<ArticleTitle>([\s\S]*?)<\/ArticleTitle>/) || "Unknown title";
  const journal = pick(/<Journal>[\s\S]*?<Title>([\s\S]*?)<\/Title>/);
  const year = pick(/<PubDate>[\s\S]*?<Year>(\d{4})<\/Year>/);

  // Abstract may be several labelled sections.
  const abstractParts = [...xml.matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g)]
    .map((m) => m[1].replace(/<[^>]+>/g, "").trim())
    .filter(Boolean);
  const abstract = abstractParts.length
    ? abstractParts.join(" ")
    : "No abstract available (common for guideline documents).";

  return { pmid, title, journal, year, abstract };
}

/**
 * High-level: search + fetch the top N articles' evidence for a clinical query.
 * Returns a formatted block ready to drop into the Management prompt.
 */
export async function gatherEvidence(query: string, topN = 3): Promise<string> {
  try {
    const pmids = await search(query, 6);
    if (pmids.length === 0) return "No PubMed evidence found for this presentation.";

    const picked = pmids.slice(0, topN);
    const results = await Promise.all(picked.map((id) => fetchOne(id)));
    const valid = results.filter((r): r is PubmedEvidence => r !== null);

    if (valid.length === 0) return "PubMed returned PMIDs but no readable abstracts.";

    return valid
      .map(
        (e) =>
          `PMID ${e.pmid} (URL: https://pubmed.ncbi.nlm.nih.gov/${e.pmid}/) — ${e.title} [${e.journal} ${e.year}]\n${e.abstract.slice(0, 700)}`
      )
      .join("\n\n");
  } catch (err) {
    return `PubMed lookup failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}
