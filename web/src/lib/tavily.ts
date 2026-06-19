// Trusted medical web search via Tavily, restricted to a whitelist of
// reputable clinical sources. Ported from the Python ManagementAgent.

const TRUSTED_DOMAINS = [
  // General journals & evidence libraries
  "nejm.org",
  "cochranelibrary.com",
  "bmj.com",
  "jamanetwork.com",
  "thelancet.com",
  "uptodate.com",
  "medscape.com",
  "mayoclinic.org",
  // Public-health & national bodies
  "who.int",
  "nice.org.uk",
  "cdc.gov",
  "nih.gov",
  "uspreventiveservicestaskforce.org",
  "sign.ac.uk",
  "g-i-n.net",
  // Australian guidelines (kept from original)
  "tg.org.au",
  "racgp.org.au",
  "aci.health.nsw.gov.au",
  // Specialty societies
  "acc.org", // ACC/AHA cardiology
  "escardio.org", // European Society of Cardiology
  "diabetes.org", // ADA
  "idsociety.org", // IDSA infectious disease
  "acog.org", // OB/GYN
  "aap.org", // Pediatrics
  "nccn.org", // Oncology
  "kdigo.org", // Nephrology
  "goldcopd.org", // COPD
  "ginasthma.org", // Asthma
  "gastro.org", // AGA gastroenterology
  // Additional verified specialty colleges & societies
  "acponline.org", // American College of Physicians
  "aan.com", // American Academy of Neurology
  "facs.org", // American College of Surgeons
  "ahajournals.org", // American Heart Association journals
  "rheumatology.org", // American College of Rheumatology
  "aad.org", // American Academy of Dermatology
  "acep.org", // American College of Emergency Physicians
  "thoracic.org", // American Thoracic Society
  "endocrine.org", // Endocrine Society
  "ese-hormones.org", // European Society of Endocrinology
  "auanet.org", // American Urological Association
  "rcog.org.uk", // Royal College of Obstetricians & Gynaecologists (UK)
  "psychiatry.org", // American Psychiatric Association
  "aacap.org", // American Academy of Child & Adolescent Psychiatry
  "aans.org", // American Association of Neurological Surgeons
  "aaos.org", // American Academy of Orthopaedic Surgeons
  "aafp.org", // American Academy of Family Physicians
  "aasld.org", // American Association for the Study of Liver Diseases
  "asco.org", // American Society of Clinical Oncology
  "hematology.org", // American Society of Hematology
  "chestnet.org", // American College of Chest Physicians
  "sccm.org", // Society of Critical Care Medicine
  "acr.org", // American College of Radiology
  "ranzcog.edu.au", // Royal Australian & NZ College of Obstetricians & Gynaecologists
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
