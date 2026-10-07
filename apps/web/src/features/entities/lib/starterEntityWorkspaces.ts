export type StarterEntitySection = {
  id: string;
  title: string;
  body: string;
};

export type StarterEntityDiff = {
  id: string;
  title: string;
  status: "new" | "changed";
  previousBody: string;
  currentBody: string;
};

export type StarterEntityTimelineItem = {
  title: string;
  summary: string;
  query: string;
  lens: string;
  revision?: number;
  updatedAt: number;
  updatedLabel: string;
  sections: StarterEntitySection[];
  diffs: StarterEntityDiff[];
  isLatest?: boolean;
};

export type StarterEntityWorkspace = {
  entity: {
    slug: string;
    name: string;
    summary: string;
    entityType: string;
    savedBecause?: string;
    reportCount: number;
    latestRevision: number;
    createdAt: number;
    updatedAt: number;
  };
  note: {
    content: string;
  };
  latest: StarterEntityTimelineItem | null;
  timeline: StarterEntityTimelineItem[];
  evidence: Array<{ label: string; type: string; sourceUrl?: string }>;
  relatedEntities?: Array<{ slug: string; name: string; entityType: string; summary: string; reason?: string }>;
};

function makeSections(what: string, why: string, missing: string, next: string): StarterEntitySection[] {
  return [
    { id: "what-it-is", title: "What it is", body: what },
    { id: "why-it-matters", title: "Why it matters", body: why },
    { id: "what-is-missing", title: "What is missing", body: missing },
    { id: "what-to-do-next", title: "What to do next", body: next },
  ];
}

const now = Date.now();

export const STARTER_ENTITY_WORKSPACES: StarterEntityWorkspace[] = [
  {
    entity: {
      slug: "axiarete",
      name: "Axiarete",
      summary: "One entity page should accumulate every run, note, and source about the company instead of freezing knowledge into isolated chats.",
      entityType: "company",
      savedBecause: "job target",
      reportCount: 2,
      latestRevision: 2,
      createdAt: now - 2 * 24 * 60 * 60 * 1000,
      updatedAt: now - 5 * 60 * 1000,
    },
    note: {
      content:
        "Keep the company, recruiter context, role fit, and implementation angle in one place. This page is the reusable memory, not the old chat transcript.",
    },
    latest: {
      title: "Axiarete company + role fit",
      summary: "Enterprise software intelligence platform with a role closer to implementation and customer translation than pure founding engineering.",
      query: "Axiarete is trying to hire me. What do they do and how do I compare against this role?",
      lens: "founder",
      revision: 2,
      updatedAt: now - 5 * 60 * 1000,
      updatedLabel: "5m ago",
      sections: makeSections(
        "Axiarete appears to help CIO and architecture teams understand, govern, and modernize complex application portfolios.",
        "The role looks closer to technical customer engagement and enterprise implementation than a pure product-building seat.",
        "Stage, reporting line, and whether the job leans delivery, solutions, or strategy are still unclear.",
        "Ask how technical the implementation work is and what success in the first 90 days actually means.",
      ),
      diffs: [
        {
          id: "why-it-matters",
          title: "Why it matters",
          status: "changed",
          previousBody: "The earlier run mostly framed this as a role-fit screen.",
          currentBody: "The newer run makes the implementation-heavy nature of the role explicit.",
        },
      ],
      isLatest: true,
    },
    timeline: [
      {
        title: "Axiarete company + role fit",
        summary: "Latest run with role-fit and implementation framing.",
        query: "Axiarete is trying to hire me. What do they do and how do I compare against this role?",
        lens: "founder",
        revision: 2,
        updatedAt: now - 5 * 60 * 1000,
        updatedLabel: "5m ago",
        sections: makeSections(
          "Axiarete appears to help CIO and architecture teams understand, govern, and modernize complex application portfolios.",
          "The role looks closer to technical customer engagement and enterprise implementation than a pure product-building seat.",
          "Stage, reporting line, and whether the job leans delivery, solutions, or strategy are still unclear.",
          "Ask how technical the implementation work is and what success in the first 90 days actually means.",
        ),
        diffs: [
          {
            id: "why-it-matters",
            title: "Why it matters",
            status: "changed",
            previousBody: "The earlier run mostly framed this as a role-fit screen.",
            currentBody: "The newer run makes the implementation-heavy nature of the role explicit.",
          },
        ],
        isLatest: true,
      },
      {
        title: "Axiarete first pass",
        summary: "Initial company understanding from a recruiter screenshot and quick search.",
        query: "What does this company do?",
        lens: "founder",
        revision: 1,
        updatedAt: now - 2 * 24 * 60 * 60 * 1000,
        updatedLabel: "2d ago",
        sections: makeSections(
          "Early pass focused on basic company identity.",
          "This established the first memory anchor.",
          "Role context, stakeholder map, and product depth.",
          "Come back with the JD and your own resume.",
        ),
        diffs: [],
      },
    ],
    evidence: [
      { label: "Axiarete AI", type: "link", sourceUrl: "https://www.axiarete.ai/" },
      { label: "Company page", type: "link", sourceUrl: "https://www.axiarete.com/company" },
      { label: "JD.pdf", type: "document" },
      { label: "Recruiter screenshot", type: "image" },
      { label: "Resume.pdf", type: "document" },
    ],
  },
  {
    entity: {
      slug: "smr-thesis",
      name: "SMR thesis",
      summary: "A market memory should keep the thesis, source map, and what changed over time without forcing you back to blank chat.",
      entityType: "market",
      savedBecause: "market watch",
      reportCount: 2,
      latestRevision: 2,
      createdAt: now - 4 * 24 * 60 * 60 * 1000,
      updatedAt: now - 22 * 60 * 1000,
    },
    note: {
      content: "Track workforce, licensing, fuel, project finance, and public-market exposure separately. This is a thesis page, not one report.",
    },
    latest: {
      title: "SMR thesis review",
      summary: "The opportunity may be real, but investability depends on licensing, labor, project finance, and actual deployment timing.",
      query: "What does this SMR thesis get right, what is missing, and what should I watch next?",
      lens: "investor",
      revision: 2,
      updatedAt: now - 22 * 60 * 1000,
      updatedLabel: "22m ago",
      sections: makeSections(
        "A standing market thesis page should keep the social narrative, official sources, and public-market proxies in one place.",
        "The thesis is only useful if it survives contact with real licensing, labor, and deployment constraints.",
        "Regional bottlenecks, specialist labor, financing, and what milestones would truly de-risk the thesis.",
        "Refresh when new official sources appear and compare the delta before you reuse the old conclusion.",
      ),
      diffs: [
        {
          id: "what-is-missing",
          title: "What is missing",
          status: "new",
          previousBody: "",
          currentBody: "Regional bottlenecks and specialist labor were added after the second run.",
        },
      ],
      isLatest: true,
    },
    timeline: [
      {
        title: "SMR thesis review",
        summary: "The latest thesis pass with updated bottlenecks and milestone checks.",
        query: "What does this SMR thesis get right, what is missing, and what should I watch next?",
        lens: "investor",
        revision: 2,
        updatedAt: now - 22 * 60 * 1000,
        updatedLabel: "22m ago",
        sections: makeSections(
          "A standing market thesis page should keep the social narrative, official sources, and public-market proxies in one place.",
          "The thesis is only useful if it survives contact with real licensing, labor, and deployment constraints.",
          "Regional bottlenecks, specialist labor, financing, and what milestones would truly de-risk the thesis.",
          "Refresh when new official sources appear and compare the delta before you reuse the old conclusion.",
        ),
        diffs: [
          {
            id: "what-is-missing",
            title: "What is missing",
            status: "new",
            previousBody: "",
            currentBody: "Regional bottlenecks and specialist labor were added after the second run.",
          },
        ],
        isLatest: true,
      },
      {
        title: "SMR first thesis pass",
        summary: "Initial market framing from a social thesis and a quick official-source pass.",
        query: "Is this SMR thesis real?",
        lens: "investor",
        revision: 1,
        updatedAt: now - 4 * 24 * 60 * 60 * 1000,
        updatedLabel: "4d ago",
        sections: makeSections(
          "Initial pass focused on the topline thesis and the most obvious public-market proxies.",
          "This created the memory anchor for later thesis updates.",
          "Licensing depth, labor constraints, and regional bottlenecks.",
          "Come back with updated official sources and public-market deltas.",
        ),
        diffs: [],
      },
    ],
    evidence: [
      { label: "IAEA SMR overview", type: "link", sourceUrl: "https://www.iaea.org/topics/small-modular-reactors" },
      { label: "IAEA 2024 SMR report", type: "link", sourceUrl: "https://www.iaea.org/publications/15790/small-modular-reactors-advances-in-smr-developments-2024" },
      { label: "Thesis note", type: "text" },
    ],
  },
];

export function getStarterEntityWorkspace(slug: string): StarterEntityWorkspace | null {
  return STARTER_ENTITY_WORKSPACES.find((workspace) => workspace.entity.slug === slug) ?? null;
}
