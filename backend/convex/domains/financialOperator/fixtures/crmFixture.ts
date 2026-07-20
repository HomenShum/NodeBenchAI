/**
 * CRM cleanup fixture — Example B in the operator-console spec.
 *
 * Stand-in for a real spreadsheet+PDF dedup pipeline. Stable, citable,
 * deterministic. Replace `extractCrmInputs` with a real reader once the
 * spreadsheet/PDF parsing surface is wired.
 */

export const CRM_FIXTURE = {
  meta: {
    files: [
      { name: "prospects.xlsx", kind: "xlsx" },
      { name: "investor_packet_1.pdf", kind: "pdf" },
      { name: "investor_packet_2.pdf", kind: "pdf" },
      { name: "investor_packet_3.pdf", kind: "pdf" },
    ],
    spreadsheetSheets: ["Raw Leads", "Notes", "Duplicates"],
    pdfPages: 86,
  },

  profile: {
    columns: ["Company", "Website", "Notes", "Partner", "Status"],
    rowCount: 387,
    missingFields: ["Sector", "HQ", "Last Round", "Source"],
  },

  entityExtraction: {
    companiesFound: 142,
    fundingEventsFound: 37,
    locationsFound: 91,
  },

  dedup: {
    originalRows: 387,
    dedupedRows: 312,
    mergedExamples: [
      {
        canonical: "Acme Bio",
        merged: ["AcmeBio", "Acme Bio Inc.", "acmebio.com"],
      },
      {
        canonical: "Northstar Robotics",
        merged: ["Northstar Robotics LLC", "northstar-robotics.io"],
      },
    ],
  },

  enrichment: {
    recordsUpdated: 241,
    lowConfidenceRecords: 31,
    unresolvedRecords: 40,
    sampleEnriched: [
      { company: "Acme Bio", sector: "Biotech", hq: "Boston, MA", lastRound: "Series B" },
      { company: "Northstar Robotics", sector: "Industrial AI", hq: "Pittsburgh, PA", lastRound: "Series A" },
      { company: "HelioGrid", sector: "Energy", hq: "Austin, TX", lastRound: "Seed" },
    ],
  },

  csvValidation: {
    schema: ["Company", "Website", "Sector", "HQ", "Last Round", "Source", "Confidence", "Owner"],
    validRows: 295,
    warningRows: 17,
    failedRows: 0,
  },
} as const;
