/**
 * ReportDetailPage — host for the recursive Cards workspace.
 *
 * v1 shipping behaviour:
 *   - Reads :reportId from the route
 *   - Calls /v1/resources/expand to load the root's ring-1 expansion
 *   - If the API is unreachable (dev w/o Convex), falls back to fixture cards
 *     so the UI can be verified end-to-end without the backend up
 *
 * Fixture fallback is tagged so users can see they are in demo mode
 * (HONEST_STATUS rule — never claim live data when serving fixtures).
 */

import { useEffect, useMemo, useState } from "react";
import { useLocation, useParams, useNavigate } from "react-router-dom";
import { ReportDetailWorkspace } from "./ReportDetailWorkspace";
import { getReportWorkspaceRouteFromPath } from "@/features/reports/lib/reportNotebookRouting";
import type {
  ResourceCard,
  ResourceUri,
} from "../../../../shared/research/resourceCards";

const API_BASE =
  (import.meta as unknown as { env?: { VITE_NODEBENCH_API_URL?: string } })
    .env?.VITE_NODEBENCH_API_URL ?? "";

// ---------------------------------------------------------------------------
// Fixture — used when /v1/resources/expand is unreachable.
// ---------------------------------------------------------------------------

const FIXTURE_ROOT_URI = "nodebench://org/acme-ai" as ResourceUri;
const FIXTURE_ROOT_LABEL = "Acme AI";

const FIXTURE_CARDS: ReadonlyArray<ResourceCard> = [
  {
    cardId: "fixture-root",
    uri: FIXTURE_ROOT_URI,
    kind: "org_summary",
    title: "Acme AI",
    subtitle: "Developer tooling · AI infrastructure",
    summary:
      "Acme AI builds agent-native developer tooling. Recent signals include a Series A, a new platform launch, and expanded investor syndicate.",
    chips: [
      { label: "company", tone: "default" },
      { label: "Series A", tone: "accent" },
    ],
    keyFacts: ["Founded 2022", "HQ: San Francisco", "Backed by XYZ Ventures"],
    nextHops: [
      "nodebench://person/jane-smith",
      "nodebench://product/acme-platform",
      "nodebench://org/xyz-ventures",
    ] as ReadonlyArray<ResourceUri>,
    confidence: 0.92,
  },
  {
    cardId: "fixture-person-1",
    uri: "nodebench://person/jane-smith" as ResourceUri,
    kind: "person_summary",
    title: "Jane Smith",
    subtitle: "founded",
    summary:
      "Co-founder and CEO. Prior: staff engineer at OpenFlow, early hire at Vercel.",
    chips: [
      { label: "Key People", tone: "accent" },
      { label: "person", tone: "default" },
    ],
    nextHops: [],
    confidence: 0.89,
  },
  {
    cardId: "fixture-product-1",
    uri: "nodebench://product/acme-platform" as ResourceUri,
    kind: "product_summary",
    title: "Acme Platform",
    subtitle: "builds",
    summary:
      "Flagship agent runtime with typed tool schemas, deterministic replay, and LangGraph integration.",
    chips: [
      { label: "Products", tone: "accent" },
      { label: "product", tone: "default" },
    ],
    nextHops: [],
    confidence: 0.85,
  },
  {
    cardId: "fixture-investor-1",
    uri: "nodebench://org/xyz-ventures" as ResourceUri,
    kind: "org_summary",
    title: "XYZ Ventures",
    subtitle: "invested_in",
    summary: "Early-stage VC. Led the Acme AI Series A.",
    chips: [
      { label: "Capital & Commercial", tone: "accent" },
      { label: "investor", tone: "default" },
    ],
    nextHops: [],
    confidence: 0.78,
  },
];

// ---------------------------------------------------------------------------

async function fetchExpand(
  uri: ResourceUri,
): Promise<ReadonlyArray<ResourceCard>> {
  if (!API_BASE) {
    throw new Error("api_unconfigured");
  }
  const res = await fetch(`${API_BASE}/v1/resources/expand`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      uri,
      lens_id: "company_dossier",
      depth: "standard",
    }),
  });
  if (!res.ok) {
    throw new Error(`expand_failed_${res.status}`);
  }
  const body = (await res.json()) as { cards?: ReadonlyArray<ResourceCard> };
  return body.cards ?? [];
}

export function ReportDetailPage() {
  const { reportId: routeReportId } = useParams<{ reportId?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const reportRoute = useMemo(
    () => getReportWorkspaceRouteFromPath(location.pathname),
    [location.pathname],
  );
  const reportId = routeReportId ?? reportRoute?.reportId;

  const [initialCards, setInitialCards] = useState<
    ReadonlyArray<ResourceCard>
  >(FIXTURE_CARDS);
  const [usingFixture, setUsingFixture] = useState<boolean>(true);
  const [rootUri] = useState<ResourceUri>(FIXTURE_ROOT_URI);
  const [rootLabel] = useState<string>(FIXTURE_ROOT_LABEL);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const cards = await fetchExpand(rootUri);
        if (cancelled) return;
        if (cards.length > 0) {
          setInitialCards(cards);
          setUsingFixture(false);
        }
      } catch {
        // API unreachable — keep fixtures. Banner already tells the user.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rootUri]);

  const onExpand = useMemo(
    () =>
      async (uri: ResourceUri): Promise<ReadonlyArray<ResourceCard>> => {
        if (usingFixture) {
          // Synthesize a small fixture expansion so drill-down works in demo.
          return [
            {
              cardId: `fixture-exp-${uri}`,
              uri,
              kind: "org_summary",
              title: uri.split("/").pop() ?? "Expanded entity",
              summary:
                "Demo expansion. Deploy the Convex ontology tables and hit /v1/resources/expand to see real one-ring cards here.",
              chips: [{ label: "demo", tone: "warn" }],
              nextHops: [],
              confidence: 0.5,
            },
          ];
        }
        return fetchExpand(uri);
      },
    [usingFixture],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {usingFixture && <FixtureBanner />}
      <ReportDetailWorkspace
        reportTitle={reportId ? `Report ${reportId}` : "Report"}
        rootUri={rootUri}
        rootLabel={rootLabel}
        initialCards={initialCards}
        onExpand={onExpand}
        initialTab={reportRoute?.tab}
        onOpenBrief={() => navigate(`/reports/${reportId ?? ""}/brief`)}
        onOpenInChat={(uri) => navigate(`/?prompt=${encodeURIComponent(uri)}`)}
      />
    </div>
  );
}

function FixtureBanner() {
  return (
    <div
      role="status"
      className="flex items-center justify-between gap-3 border-b border-amber-400/30 bg-amber-500/[0.08] px-3 py-2 text-[11px] text-amber-200"
    >
      <span className="truncate">
        <strong className="font-semibold">Demo mode:</strong> this workspace is
        using fixture cards. Deploy the ontology tables and configure
        <code className="mx-1 rounded bg-white/[0.04] px-1">
          VITE_NODEBENCH_API_URL
        </code>
        to see real expansions.
      </span>
    </div>
  );
}

export default ReportDetailPage;
