// Trusted medical web search via Tavily, restricted to a whitelist of
// reputable clinical sources. Ported from the Python ManagementAgent.

const TRUSTED_DOMAINS = [
  "nejm.org",
  "cochrane.org",
  "nice.org.uk",
  "medscape.com",
  "mayoclinic.org",
  "cdc.gov",
  "who.int",
  "bmj.com",
  "uptodate.com",
  "tg.org.au",
  "racgp.org.au",
  "aci.health.nsw.gov.au",
  "jamanetwork.com",
  "thelancet.com",
];

/** Search trusted medical sites; returns a formatted excerpt block. */
export async function trustedMedicalSearch(query: string, maxResults = 4): Promise<string> {
  const key = process.env.TAVILY_API_KEY;
  if (!key || key.includes("your_")) {
    return "Trusted-site search unavailable (no Tavily key configured).";
  }
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        query,
        max_results: maxResults,
        include_domains: TRUSTED_DOMAINS,
        search_depth: "advanced",
      }),
    });
    if (!res.ok) return "Trusted-site search returned no results.";
    const data = await res.json();
    const results = data?.results ?? [];
    if (results.length === 0) return "No results on trusted medical sites.";
    return results
      .map(
        (r: { url?: string; title?: string; content?: string }) =>
          `Source: ${r.url}\nTitle: ${r.title}\n${(r.content || "").slice(0, 500)}`
      )
      .join("\n\n");
  } catch (err) {
    return `Trusted-site search failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}
