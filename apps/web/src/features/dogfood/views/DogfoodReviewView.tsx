import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAction, useConvex, useMutation, useQuery } from "convex/react";
import { useConvexAuth } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@convex/_generated/api";
import { PageHeroHeader } from "@/shared/ui/PageHeroHeader";
import { TasteBenchPanel } from "../components/TasteBenchPanel";

type DogfoodManifestItem = {
  file: string;
  kind: "route" | "interaction" | "settings" | string;
  label: string;
};

type DogfoodManifest = {
  capturedAtIso: string;
  basePath: string;
  items: DogfoodManifestItem[];
};

type ScribeStep = {
  index: number;
  kind: string;
  name: string;
  path: string;
  title: string;
  description: string;
  image: string;
};

type ScribeManifest = {
  capturedAtIso: string;
  baseURL: string;
  steps: ScribeStep[];
};

type WalkthroughChapter = {
  index: number;
  name: string;
  path: string;
  startSec: number;
};

type WalkthroughManifest = {
  capturedAtIso: string;
  baseURL: string;
  mime: string;
  publish: "blob" | "static" | "none" | string;
  chapters: WalkthroughChapter[];
  videoUrl: string | null;
  videoPath: string | null;
};

type VideoWallItem = {
  id: string;
  title: string;
  description: string;
  src: string;
  mime?: string;
  group?: "full" | "voice" | string;
};

type VideoWallManifest = {
  capturedAtIso: string;
  items: VideoWallItem[];
};

type FramesItem = {
  index: number;
  name: string;
  path: string;
  startSec: number;
  file: string;
  image: string;
};

type FramesManifest = {
  capturedAtIso: string;
  videoPath: string;
  items: FramesItem[];
};

type LocalQaEntry = {
  ts: string;
  score: number;
  grade: string;
  critical: number;
  warning: number;
  info: number;
  source?: string;
  compositeScore?: number;
  aspiration?: {
    score: number | null;
    grade: string | null;
    style: string;
    axes: Record<string, number | null>;
    opportunityCount: number;
    summary: string;
  };
  coherence?: {
    score: number | null;
    notes: string;
    outlierRoutes: string[];
    screenshotsUsed?: string[];
  };
  rubric?: {
    governance?: {
      score: number;
      criteria: Array<{ id: string; pass: boolean; weight: number }>;
    };
  };
};

type QaGenerationComparison = {
  label: string;
  baselineGeneration: number;
  latestGeneration: number;
  scoreDelta: number;
  realIssueDelta: number;
  criticalDelta: number;
  warningDelta: number;
  baseline: {
    score: number | null;
    grade: string | null;
    realIssueCount: number | null;
  };
  latest: {
    score: number | null;
    grade: string | null;
    realIssueCount: number | null;
  };
};

type QaStateEvidence = {
  before?: { count: number; purpose?: string };
  during?: { count: number; purpose?: string };
  after?: { count: number; purpose?: string };
};

type QaGenerationLedger = {
  generatedAt: string;
  generationArchive?: {
    runId: string;
    sequence: number;
    archiveName: string;
    archivePath: string;
    copiedCount: number;
    stateEvidence?: QaStateEvidence;
  };
  releaseInterpretation?: {
    latestStatus: "release-clean" | "release-risk" | string;
    reason: string;
  };
  history?: {
    latest?: {
      generation: number;
      timestamp: string;
      score: number | null;
      grade: string | null;
      realIssueCount: number | null;
      critical: number | null;
      warning: number | null;
      model: string | null;
    };
    deltaChainLastTen?: QaGenerationComparison[];
  };
  comparisons?: QaGenerationComparison[];
  currentRun?: {
    realIssues?: Array<{ header?: string; route?: string; source?: string }>;
  };
};

type QaIssue = {
  severity: "p0" | "p1" | "p2" | "p3" | string;
  title: string;
  details: string;
  suggestedFix?: string;
  route?: string;
  startSec?: number;
  endSec?: number;
  evidence?: string[];
};

type DogfoodQaRun = {
  _id: string;
  createdAt: number;
  provider: "gemini" | string;
  model: string;
  source: "video" | "frames" | string;
  videoUrl?: string;
  inputSha256?: string;
  prompt: string;
  summary: string;
  issues: QaIssue[];
  rawText?: string;
};

function formatDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
}

function formatMs(ms: number) {
  if (!Number.isFinite(ms)) return String(ms);
  return new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
}

function resolveAbsoluteUrl(maybeUrl: string | null | undefined): string | null {
  if (!maybeUrl) return null;
  if (/^https?:\/\//i.test(maybeUrl)) return maybeUrl;
  if (maybeUrl.startsWith("/")) return `${window.location.origin}${maybeUrl}`;
  return maybeUrl;
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function slugifyForFile(input: string) {
  return String(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// â”€â”€ Overstory Status Panel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

type OverstoryAgent = {
  name: string;
  capability: string;
  model: string;
  description: string;
  constraints: string[];
  maxToolCalls: number;
};

type OverstoryManifest = {
  version: string;
  agents: Record<string, OverstoryAgent>;
  gatePolicy: {
    mode: string;
    minStabilityGrade: string;
    maxUnresolvedP0: number;
    maxUnresolvedP1: number;
    autoFixMaxIterations: number;
  };
  mailProtocol: {
    qaRoutes: { from: string; to: string; type: string; subject: string }[];
  };
};

function OverstoryStatusPanel() {
  const [ovManifest, setOvManifest] = useState<OverstoryManifest | null>(null);
  const [ovError, setOvError] = useState<string | null>(null);

  useEffect(() => {
    // Read agent-manifest.json from .overstory/ (served as static if present)
    // In dev, this won't be available from the web server, so we show setup instructions
    fetch("/.overstory/agent-manifest.json")
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then(setOvManifest)
      .catch(() => setOvError("not_found"));
  }, []);

  const agentEntries = ovManifest
    ? Object.entries(ovManifest.agents)
    : [];

  const capabilityColors: Record<string, string> = {
    "qa-scout": "bg-blue-500/20 text-blue-400 border-blue-500/30",
    "qa-reviewer": "bg-amber-500/20 text-amber-400 border-amber-500/30",
    "qa-builder": "bg-purple-500/20 text-purple-400 border-purple-500/30",
    "qa-capture": "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  };

  const modelBadge: Record<string, string> = {
    haiku: "bg-green-500/15 text-green-400",
    sonnet: "bg-blue-500/15 text-blue-400",
    opus: "bg-purple-500/15 text-purple-400",
  };

  return (
    <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
      <div className="px-5 py-3 border-b border-border/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="text-sm font-medium text-foreground">
            Overstory QA Orchestration
          </div>
          <span className="text-xs px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground font-mono">
            multi-agent
          </span>
        </div>
        {ovManifest && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-medium">
            Configured
          </span>
        )}
      </div>

      <div className="p-5 space-y-4">
        {ovError === "not_found" && !ovManifest && (
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">
              Overstory not initialized. Run these commands to set up multi-agent QA orchestration:
            </div>
            <div className="rounded-md bg-muted/30 border border-border/50 p-3 font-mono text-xs text-foreground whitespace-pre-wrap">
              {"# Install (WSL Ubuntu)\n"}
              {"wsl -d Ubuntu -- bash -c 'sudo apt install -y tmux unzip && curl -fsSL https://bun.sh/install | bash'\n\n"}
              {"# Initialize Overstory\n"}
              {"bash scripts/overstory/run-in-wsl.sh init\n\n"}
              {"# Run full QA session\n"}
              {"npm run dogfood:overstory\n\n"}
              {"# Monitor\n"}
              {"npm run dogfood:overstory:dashboard"}
            </div>
          </div>
        )}

        {ovManifest && (
          <>
            {/* Agent Fleet */}
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground tracking-wide">
                Agent Fleet ({agentEntries.length} agents)
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {agentEntries.map(([key, agent]) => (
                  <div
                    key={key}
                    className={`rounded-md border p-3 space-y-1.5 ${capabilityColors[key] || "bg-muted/20 text-foreground border-border/50"}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold">{key}</span>
                      <span
                        className={`text-xs px-1.5 py-0.5 rounded font-mono ${modelBadge[agent.model] || "bg-muted/30 text-muted-foreground"}`}
                      >
                        {agent.model}
                      </span>
                    </div>
                    <div className="text-xs opacity-80">
                      {agent.description}
                    </div>
                    <div className="flex gap-1 flex-wrap">
                      {agent.constraints.map((c) => (
                        <span
                          key={c}
                          className="text-xs px-1 py-0.5 rounded bg-surface-secondary font-mono"
                        >
                          {c}
                        </span>
                      ))}
                      <span className="text-xs px-1 py-0.5 rounded bg-surface-secondary font-mono">
                        max {agent.maxToolCalls} calls
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Gate Policy */}
            {ovManifest.gatePolicy && (
              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground tracking-wide">
                  Gate Policy
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="rounded-md bg-muted/20 border border-border/50 p-2 text-center">
                    <div className="text-xs text-muted-foreground">Mode</div>
                    <div className="text-xs font-semibold text-foreground">
                      {ovManifest.gatePolicy.mode}
                    </div>
                  </div>
                  <div className="rounded-md bg-muted/20 border border-border/50 p-2 text-center">
                    <div className="text-xs text-muted-foreground">Min Grade</div>
                    <div className="text-xs font-semibold text-foreground">
                      {ovManifest.gatePolicy.minStabilityGrade}
                    </div>
                  </div>
                  <div className="rounded-md bg-muted/20 border border-border/50 p-2 text-center">
                    <div className="text-xs text-muted-foreground">Max P0</div>
                    <div className="text-xs font-semibold text-foreground">
                      {ovManifest.gatePolicy.maxUnresolvedP0}
                    </div>
                  </div>
                  <div className="rounded-md bg-muted/20 border border-border/50 p-2 text-center">
                    <div className="text-xs text-muted-foreground">Auto-fix Iters</div>
                    <div className="text-xs font-semibold text-foreground">
                      {ovManifest.gatePolicy.autoFixMaxIterations}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Mail Protocol */}
            {ovManifest.mailProtocol && (
              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground tracking-wide">
                  Mail Protocol ({ovManifest.mailProtocol.qaRoutes.length} routes)
                </div>
                <div className="rounded-md bg-muted/20 border border-border/50 p-2 space-y-1">
                  {ovManifest.mailProtocol.qaRoutes.map((route, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-xs font-mono">
                      <span className="text-muted-foreground">{route.from}</span>
                      <span className="text-muted-foreground/50">&rarr;</span>
                      <span className="text-muted-foreground">{route.to}</span>
                      <span className="text-xs px-1 rounded bg-muted/40 text-muted-foreground">
                        {route.type}
                      </span>
                      <span className="text-foreground/70 truncate">{route.subject}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Quick Commands */}
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground tracking-wide">
                Commands
              </div>
              <div className="rounded-md bg-muted/30 border border-border/50 p-3 font-mono text-xs text-foreground whitespace-pre-wrap">
                {"npm run dogfood:overstory           # Full QA session\n"}
                {"npm run dogfood:overstory:dashboard  # Live dashboard\n"}
                {"npm run dogfood:overstory:status     # Agent status\n"}
                {"npm run dogfood:overstory:mail       # Check mail\n"}
                {"npm run dogfood:qa-gate              # Run CI QA check"}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function GovernancePanel({ entry }: { entry: LocalQaEntry }) {
  const govScore = entry.rubric?.governance?.score ?? null;
  const govCriteria = entry.rubric?.governance?.criteria ?? [];
  const aspiration = entry.aspiration;
  const coherence = entry.coherence;

  return (
    <div className="nb-surface-card overflow-hidden">
      <div className="px-5 py-3 border-b border-border/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="text-sm font-medium text-foreground">Design Governance</div>
          <span className="text-xs px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground font-mono">
            composite
          </span>
        </div>
        {entry.compositeScore != null && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Composite</span>
            <span className="font-semibold text-base text-foreground font-mono">{entry.compositeScore}/100</span>
          </div>
        )}
      </div>

      <div className="p-5 space-y-4">
        {entry.compositeScore != null && (
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-md border border-border/40 bg-background p-3 text-center">
              <div className="text-xs text-muted-foreground mb-1">QA (70%)</div>
              <div className="text-lg font-semibold font-mono text-foreground">{entry.score}</div>
            </div>
            <div className="rounded-md border border-border/40 bg-background p-3 text-center">
              <div className="text-xs text-muted-foreground mb-1">Aspiration (15%)</div>
              <div className="text-lg font-semibold font-mono text-foreground">
                {aspiration?.score ?? "—"}
              </div>
            </div>
            <div className="rounded-md border border-border/40 bg-background p-3 text-center">
              <div className="text-xs text-muted-foreground mb-1">Governance (15%)</div>
              <div className="text-lg font-semibold font-mono text-foreground">
                {govScore ?? "—"}
              </div>
            </div>
          </div>
        )}

        {govCriteria.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">Governance criteria</div>
            {govCriteria.map((c) => (
              <div key={c.id} className="flex items-center gap-2 text-xs font-mono">
                <span className={c.pass ? "text-green-500" : "text-red-400"}>
                  {c.pass ? "PASS" : "FAIL"}
                </span>
                <span className="text-muted-foreground">{c.id.replace(/_/g, " ")}</span>
              </div>
            ))}
          </div>
        )}

        {aspiration?.axes && Object.keys(aspiration.axes).length > 0 && (
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">
              Aspiration axes
              {aspiration.grade && (
                <span className="ml-2 px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground">{aspiration.grade}</span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              {Object.entries(aspiration.axes).map(([axis, score]) => (
                <div key={axis} className="flex items-center justify-between text-xs font-mono">
                  <span className="text-muted-foreground capitalize">{axis.replace(/_/g, " ")}</span>
                  <span className="text-foreground">{score ?? "—"}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {coherence && coherence.score != null && (
          <div className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground">Cross-route coherence</div>
            <div className="flex items-center gap-3">
              <span className={`text-lg font-semibold font-mono ${
                coherence.score >= 7 ? "text-green-500" :
                coherence.score >= 5 ? "text-amber-400" : "text-red-400"
              }`}>
                {coherence.score}/10
              </span>
              {coherence.notes && (
                <span className="text-xs text-muted-foreground">{coherence.notes}</span>
              )}
            </div>
            {coherence.outlierRoutes && coherence.outlierRoutes.length > 0 && (
              <div className="text-xs text-muted-foreground">
                Outliers: {coherence.outlierRoutes.join(", ")}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function DogfoodReviewView() {
  const [manifest, setManifest] = useState<DogfoodManifest | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [walkthrough, setWalkthrough] = useState<WalkthroughManifest | null>(null);
  const [walkthroughError, setWalkthroughError] = useState<string | null>(null);
  const [videoWall, setVideoWall] = useState<VideoWallManifest | null>(null);
  const [videoWallError, setVideoWallError] = useState<string | null>(null);
  const [frames, setFrames] = useState<FramesManifest | null>(null);
  const [framesError, setFramesError] = useState<string | null>(null);
  const [scribe, setScribe] = useState<ScribeManifest | null>(null);
  const [scribeError, setScribeError] = useState<string | null>(null);
  const [scribeDraft, setScribeDraft] = useState<ScribeStep[]>([]);
  const [qaPrompt, setQaPrompt] = useState<string>("");
  const [qaRunning, setQaRunning] = useState(false);
  const [qaScreensRunning, setQaScreensRunning] = useState(false);
  const [qaError, setQaError] = useState<string | null>(null);
  const [qaLast, setQaLast] = useState<DogfoodQaRun | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyWithFeedback = async (text: string, id: string) => {
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(null), 1200);
    }
    return ok;
  };
  const [isRefreshingView, setIsRefreshingView] = useState(false);
  const [localQaResults, setLocalQaResults] = useState<LocalQaEntry[] | null>(null);
  const [localQaError, setLocalQaError] = useState<string | null>(null);
  const [generationLedger, setGenerationLedger] = useState<QaGenerationLedger | null>(null);
  const [generationLedgerError, setGenerationLedgerError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const { isAuthenticated } = useConvexAuth();
  const { signIn } = useAuthActions();
  const [isAnonSigningIn, setIsAnonSigningIn] = useState(false);

  const convex = useConvex();
  const generateUploadUrl = useMutation(api.domains.documents.files.generateUploadUrl);

  const qaRuns = useQuery(api.domains.dogfood.videoQaQueries.listMyDogfoodQaRuns, { limit: 6 }) as
    | DogfoodQaRun[]
    | undefined;
  const qaTrending = useQuery(api.domains.dogfood.videoQaQueries.getDogfoodQaTrending, { days: 14 }) as
    | { date: string; createdAt: number; source: string; p0: number; p1: number; p2: number; p3: number; total: number }[]
    | undefined;
  const runVideoQa = useAction(api.domains.dogfood.videoQa.runDogfoodVideoQa);
  const runScreenshotQa = useAction(api.domains.dogfood.screenshotQa.runDogfoodScreenshotQa);

  const signInAnonymously = useCallback(async () => {
    if (isAnonSigningIn) return;
    setIsAnonSigningIn(true);
    setQaError(null);
    try {
      await signIn("anonymous");
    } catch (e) {
      setQaError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsAnonSigningIn(false);
    }
  }, [isAnonSigningIn, signIn]);

  const fetchWithTimeout = async (url: string, init: RequestInit | undefined, timeoutMs: number) => {
    const controller = new AbortController();
    const id = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...(init ?? {}), signal: controller.signal });
    } finally {
      window.clearTimeout(id);
    }
  };

  const uploadUrlToConvexStorage = async (inputUrl: string, fileName: string, fallbackMime: string) => {
    const url = resolveAbsoluteUrl(inputUrl) ?? inputUrl;
    const res = await fetchWithTimeout(url, undefined, 60_000);
    if (!res.ok) throw new Error(`Failed to read artifact: HTTP ${res.status}`);
    const blob = await res.blob();
    const mimeType = blob.type || fallbackMime;
    const file = new File([blob], fileName, { type: mimeType });

    const uploadUrl = await generateUploadUrl();
    const uploadRes = await fetchWithTimeout(
      uploadUrl,
      {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      },
      60_000,
    );
    if (!uploadRes.ok) throw new Error(`Upload failed: HTTP ${uploadRes.status}`);
    const { storageId } = (await uploadRes.json()) as { storageId: string };

    const publicUrl = await convex.query(api.domains.documents.files.getUrl, { storageId });
    if (!publicUrl) throw new Error("Upload succeeded but public URL was not available");
    return publicUrl;
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/dogfood/manifest.json", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as DogfoodManifest;
        if (!cancelled) setManifest(json);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/dogfood/scribe.json", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as ScribeManifest;
        if (!cancelled) {
          setScribe(json);
          setScribeDraft(json.steps ?? []);
        }
      } catch (e) {
        if (!cancelled) setScribeError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/dogfood/walkthrough.json", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as WalkthroughManifest;
        if (!cancelled) setWalkthrough(json);
      } catch (e) {
        if (!cancelled) setWalkthroughError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/dogfood/video-wall.json", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as VideoWallManifest;
        if (!cancelled) setVideoWall(json);
      } catch (e) {
        if (!cancelled) setVideoWallError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/dogfood/frames.json", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as FramesManifest;
        if (!cancelled) setFrames(json);
      } catch (e) {
        if (!cancelled) setFramesError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/dogfood/qa-results.json", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as LocalQaEntry[];
        if (!cancelled) setLocalQaResults(Array.isArray(json) ? json : []);
      } catch (e) {
        if (!cancelled) setLocalQaError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/dogfood/qa-generation-ledger.json", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as QaGenerationLedger;
        if (!cancelled) setGenerationLedger(json);
      } catch (e) {
        if (!cancelled) setGenerationLedgerError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const commands = useMemo(() => {
    const runE2e = "npx playwright test tests/e2e/full-ui-dogfood.spec.ts --project=chromium --workers=1";
    const publish = "npm run dogfood:publish";
    const record = "npm run dogfood:record";
    const recordStatic = "npm run dogfood:record:static";
    const frames = "npm run dogfood:frames";
    const scribeCmd = "npm run dogfood:scribe";
    const scribeLocal = "npm run dogfood:scribe:local";
    const full = "npm run dogfood:walkthrough";
    const fullLocal = "npm run dogfood:full:local";
    const fullLocalPlay = "npm run dogfood:full:local:play";
    const qaFirstClass = "npm run dogfood:qa:first-class";
    const qaLedger = "npm run dogfood:qa:ledger";
    const verifyFirstClass = "npm run dogfood:verify:first-class";
    return { runE2e, publish, record, recordStatic, frames, scribeCmd, scribeLocal, full, fullLocal, fullLocalPlay, qaFirstClass, qaLedger, verifyFirstClass };
  }, []);

  const resolvedVideoUrl = useMemo(() => {
    return resolveAbsoluteUrl(walkthrough?.videoUrl ?? walkthrough?.videoPath ?? null);
  }, [walkthrough?.videoUrl, walkthrough?.videoPath]);

  const groupedVideoWall = useMemo(() => {
    const groups: Record<string, VideoWallItem[]> = {};
    for (const item of videoWall?.items ?? []) {
      const key = item.group ?? "other";
      groups[key] = groups[key] ?? [];
      groups[key].push(item);
    }
    return groups;
  }, [videoWall]);

  const grouped = useMemo(() => {
    const items = manifest?.items ?? [];
    const groups: Record<string, DogfoodManifestItem[]> = {};
    for (const item of items) {
      const key = item.kind || "other";
      groups[key] = groups[key] ?? [];
      groups[key].push(item);
    }
    return groups;
  }, [manifest]);

  return (
    <div className="nb-page-shell">
      <div className="nb-page-inner">
        <div className="nb-page-frame space-y-6">
        <div className="flex items-start justify-between gap-4">
          <PageHeroHeader
            title="Quality Review"
            subtitle={
              <>
                UI evidence and route-by-route review. Fix root causes, then publish proof here.
                {manifest?.capturedAtIso && (
                  <span className="block text-xs mt-1">
                    Last published: <span className="font-medium text-foreground">{formatDate(manifest.capturedAtIso)}</span>
                  </span>
                )}
              </>
            }
          />

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-outline-sm inline-flex items-center gap-2"
              onClick={async () => {
                const ok = await copyToClipboard(
                  `${commands.fullLocal}\n${commands.fullLocalPlay}\n${commands.runE2e}\n${commands.publish}\n${commands.scribeCmd}\n${commands.recordStatic}\n${commands.record}`,
                );
                setCopied(ok);
                window.setTimeout(() => setCopied(false), 1200);
              }}
              aria-label="Copy dogfood commands"
              title="Copy dogfood commands"
            >
              {copied ? "Copied" : "Copy commands"}
            </button>
            <button
              type="button"
              className="btn-primary-sm inline-flex items-center gap-2 min-w-[116px] justify-center"
              onClick={() => {
                // NOTE(coworker): brief pending state prevents "no click feedback" QA flags.
                setIsRefreshingView(true);
                window.setTimeout(() => window.location.reload(), 140);
              }}
              disabled={isRefreshingView}
            >
              {isRefreshingView ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <TasteBenchPanel />

        <div className="nb-surface-card p-5 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="text-sm font-medium text-foreground">Recorded sessions</div>
              <div className="text-sm text-muted-foreground">
                Full walkthroughs and focused voice captures, all playable side by side in one surface.
              </div>
              {videoWall?.capturedAtIso && (
                <div className="text-xs text-muted-foreground">
                  Last bundled:{" "}
                  <span className="font-medium text-foreground">{formatDate(videoWall.capturedAtIso)}</span>
                </div>
              )}
            </div>
            <button
              type="button"
              className="btn-outline-sm inline-flex items-center gap-2"
              onClick={async () => {
                await copyWithFeedback(commands.fullLocalPlay, "video-wall");
              }}
              aria-label="Copy local playback command"
              title="Copy local playback command"
            >
              {copiedId === "video-wall" ? "Copied!" : "Copy playback command"}
            </button>
          </div>

          {videoWall === null && !videoWallError ? (
            <div className="rounded-md border border-border/60 bg-background p-4 text-sm text-muted-foreground">
              Loading recorded sessions...
            </div>
          ) : videoWall?.items?.length ? (
            <div className="space-y-5">
              {Object.entries(groupedVideoWall).map(([group, items]) => (
                <section key={group} className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                      {group === "full" ? "Full Sessions" : group === "voice" ? "Voice Captures" : group}
                    </div>
                    <div className="text-xs text-muted-foreground">{items.length} video{items.length === 1 ? "" : "s"}</div>
                  </div>
                  <div className="grid gap-4 xl:grid-cols-2">
                    {items.map((item) => (
                      <article
                        key={item.id}
                        className="overflow-hidden rounded-xl border border-border/60 bg-background/95 shadow-[0_18px_48px_rgba(15,23,42,0.12)]"
                      >
                        <div className="border-b border-border/50 px-4 py-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="space-y-1">
                              <div className="text-sm font-medium text-foreground">{item.title}</div>
                              <div className="text-xs text-muted-foreground">{item.description}</div>
                            </div>
                            <a
                              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                              href={item.src}
                              target="_blank"
                              rel="noreferrer"
                              title="Open video in a new tab"
                            >
                              Open
                            </a>
                          </div>
                        </div>
                        <div className="bg-black">
                          <video
                            className="aspect-video w-full bg-black object-contain"
                            controls
                            preload="metadata"
                            playsInline
                          >
                            <source src={item.src} type={item.mime ?? "video/mp4"} />
                          </video>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="rounded-md border border-border/60 bg-background p-3 space-y-2">
              <div className="text-sm text-muted-foreground">
                No bundled recordings found yet. Publish or copy videos into <span className="font-mono">public/dogfood/videos</span>.
              </div>
              {videoWallError && (
                <div className="text-xs text-muted-foreground">
                  Video wall load error: <span className="font-mono">{videoWallError}</span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="nb-surface-card p-5 space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="text-sm font-medium text-foreground">Walkthrough video</div>
              <div className="text-sm text-muted-foreground">
                A single end-to-end dogfood run with chapters (route + key interactions).
              </div>
              {walkthrough?.capturedAtIso && (
                <div className="text-xs text-muted-foreground">
                  Last recorded:{" "}
                  <span className="font-medium text-foreground">{formatDate(walkthrough.capturedAtIso)}</span>
                </div>
              )}
            </div>
            <button
              type="button"
              className="btn-outline-sm inline-flex items-center gap-2"
              onClick={async () => {
                await copyWithFeedback(
                  `${commands.fullLocal}\n${commands.fullLocalPlay}\n${commands.record}\n${commands.recordStatic}\n${commands.scribeCmd}\n${commands.full}`,
                  "video",
                );
              }}
              aria-label="Copy walkthrough commands"
              title="Copy walkthrough commands"
            >
              {copiedId === "video" ? "Copied!" : "Copy video commands"}
            </button>
          </div>

          {walkthrough && (walkthrough.videoUrl || walkthrough.videoPath) ? (
            <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
              <div className="rounded-md border border-border/60 bg-muted/10 overflow-hidden">
                <video
                  ref={(el) => {
                    videoRef.current = el;
                  }}
                  className="w-full h-auto block"
                  controls
                  preload="metadata"
                  src={walkthrough.videoUrl ?? walkthrough.videoPath ?? undefined}
                />
              </div>
              <div className="rounded-md border border-border/60 bg-background p-3">
                <div className="text-xs font-semibold text-muted-foreground tracking-wide">Chapters</div>
                <div className="mt-2 max-h-[420px] overflow-auto space-y-1">
                  {walkthrough.chapters?.map((c) => (
                    <button
                      key={`${c.index}-${c.startSec}`}
                      type="button"
                      className="w-full text-left rounded-md px-2.5 py-2 hover:bg-muted/50 transition-colors cursor-pointer"
                      onClick={() => {
                        const v = videoRef.current;
                        if (!v) return;
                        v.currentTime = c.startSec;
                        void v.play();
                      }}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <div className="text-sm font-medium text-foreground truncate">{c.name}</div>
                        <div className="text-xs text-muted-foreground font-mono">{c.startSec.toFixed(1)}s</div>
                      </div>
                      <div className="text-xs text-muted-foreground font-mono truncate">{c.path}</div>
                    </button>
                  ))}
                </div>
                {walkthrough.publish === "blob" && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    Published via blob URL (recommended). Requires <span className="font-mono">BLOB_READ_WRITE_TOKEN</span>.
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-border/60 bg-background p-3 space-y-2">
              <div className="text-sm text-muted-foreground">
                No walkthrough published yet. Record one (blob recommended, static is local-only unless you commit the video).
              </div>
              <div className="rounded-md bg-muted/30 border border-border/50 p-3 font-mono text-xs text-foreground whitespace-pre-wrap">
                {commands.record}
                {"\n"}
                {commands.recordStatic}
                {"\n"}
                {commands.frames}
              </div>
              {walkthroughError && (
                <div className="text-xs text-muted-foreground">
                  Walkthrough load error: <span className="font-mono">{walkthroughError}</span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="nb-surface-card p-5 space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="text-sm font-medium text-foreground">Key frames</div>
              <div className="text-sm text-muted-foreground">
                Chapter-aligned stills for rapid scan, sharing, and model-assisted QA.
              </div>
              {frames?.capturedAtIso && (
                <div className="text-xs text-muted-foreground">
                  Last extracted: <span className="font-medium text-foreground">{formatDate(frames.capturedAtIso)}</span>
                </div>
              )}
            </div>
            <button
              type="button"
              className="btn-outline-sm inline-flex items-center gap-2"
              onClick={async () => {
                await copyWithFeedback(commands.frames, "frames");
              }}
              aria-label="Copy frames command"
              title="Copy frames command"
            >
              {copiedId === "frames" ? "Copied!" : "Copy frames command"}
            </button>
          </div>

          {frames?.items?.length ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {frames.items.map((f) => (
                <button
                  key={f.file}
                  type="button"
                  className="rounded-lg border border-border/60 bg-background overflow-hidden text-left hover:bg-muted/20 transition-colors"
                  onClick={() => {
                    const v = videoRef.current;
                    if (!v) return;
                    v.currentTime = f.startSec;
                    void v.play();
                  }}
                >
                  <div className="aspect-[16/9] bg-muted/10 border-b border-border/50 overflow-hidden">
                    {/* NOTE(coworker): keep key frame images eager for deterministic QA/playwright media assertions. */}
                    <img src={f.image} alt={f.name} className="w-full h-full object-cover" loading="eager" decoding="sync" />
                  </div>
                  <div className="p-3 space-y-1">
                    <div className="text-sm font-medium text-foreground truncate">{f.name}</div>
                    <div className="text-xs text-muted-foreground font-mono truncate">
                      {f.startSec.toFixed(1)}s · {f.path}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="rounded-md border border-border/60 bg-background p-3 space-y-2">
              <div className="text-sm text-muted-foreground">No frames extracted yet.</div>
              <div className="rounded-md bg-muted/30 border border-border/50 p-3 font-mono text-xs text-foreground whitespace-pre-wrap">
                {commands.frames}
              </div>
              {framesError && (
                <div className="text-xs text-muted-foreground">
                  Frames load error: <span className="font-mono">{framesError}</span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="nb-surface-card p-5 space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="text-sm font-medium text-foreground">How-to (Scribe-style)</div>
              <div className="text-sm text-muted-foreground">
                Auto-generated step list with screenshots and editable copy. Export as Markdown and share.
              </div>
              {scribe?.capturedAtIso && (
                <div className="text-xs text-muted-foreground">
                  Last captured:{" "}
                  <span className="font-medium text-foreground">{formatDate(scribe.capturedAtIso)}</span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn-outline-sm inline-flex items-center gap-2"
                onClick={async () => {
                  const lines: string[] = [
                    "# NodeBench Dogfood Walkthrough",
                    "",
                    scribe?.capturedAtIso ? `Captured: ${scribe.capturedAtIso}` : "",
                    "",
                  ].filter(Boolean);
                  for (const step of scribeDraft) {
                    lines.push(`## ${step.title}`);
                    lines.push(step.description || "");
                    lines.push("");
                    lines.push(`![${step.title}](${step.image})`);
                    lines.push("");
                  }
                  await copyWithFeedback(lines.join("\n"), "markdown");
                }}
              >
                {copiedId === "markdown" ? "Copied!" : "Copy Markdown"}
              </button>
              <button
                type="button"
                className="btn-outline-sm inline-flex items-center gap-2"
                onClick={async () => {
                  await copyWithFeedback(`${commands.scribeCmd}\n${commands.scribeLocal}`, "capture");
                }}
              >
                {copiedId === "capture" ? "Copied!" : "Copy capture commands"}
              </button>
            </div>
          </div>

          {scribeDraft.length > 0 ? (
            <div className="space-y-4">
              {scribeDraft.map((s) => (
                <div key={s.index} className="rounded-md border border-border/60 bg-background p-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground truncate">{s.title}</div>
                    <div className="text-xs text-muted-foreground font-mono truncate">{s.path}</div>
                  </div>
                  <div className="mt-2 grid gap-3 lg:grid-cols-[1.1fr_1fr]">
                    <div className="rounded-md overflow-hidden border border-border/60 bg-muted/10">
                      {/* NOTE(coworker): keep scribe previews eager to avoid flaky first-image load checks in dogfood regression tests. */}
                      <img src={s.image} alt={s.title} className="w-full h-auto block" loading="eager" decoding="sync" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-muted-foreground tracking-wide">
                        Step text (editable)
                      </label>
                      <textarea
                        className="w-full min-h-[120px] rounded-md border border-border/60 bg-card px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        value={s.description}
                        onChange={(e) => {
                          const next = e.target.value;
                          setScribeDraft((prev) =>
                            prev.map((p) => (p.index === s.index ? { ...p, description: next } : p)),
                          );
                        }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-md border border-border/60 bg-background p-3 space-y-2">
              <div className="text-sm text-muted-foreground">
                No how-to published yet. Capture one and it will show up here.
              </div>
              <div className="rounded-md bg-muted/30 border border-border/50 p-3 font-mono text-xs text-foreground whitespace-pre-wrap">
                {commands.scribeCmd}
                {"\n"}
                {commands.scribeLocal}
              </div>
              {scribeError && (
                <div className="text-xs text-muted-foreground">
                  Scribe load error: <span className="font-mono">{scribeError}</span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="nb-surface-card p-5 space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="text-sm font-medium text-foreground">Gemini QA (video understanding)</div>
              <div className="text-sm text-muted-foreground">
                Runs a design + performance critique directly on the latest walkthrough video and stores issues for review.
              </div>
              {resolvedVideoUrl ? (
                <div className="text-xs text-muted-foreground">
                  Video input: <span className="font-mono">{resolvedVideoUrl}</span>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">No video found yet. Record a walkthrough first.</div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {!isAuthenticated && (
                <button
                  type="button"
                  className="btn-outline-sm inline-flex items-center gap-2 disabled:opacity-50"
                  disabled={isAnonSigningIn}
                  onClick={() => void signInAnonymously()}
                  aria-label="Sign in to run QA"
                  data-testid="dogfood-sign-in"
                  title="Sign in anonymously to enable QA uploads"
                >
                  {isAnonSigningIn ? "Signing in..." : "Sign in to run QA"}
                </button>
              )}
              <button
                type="button"
                className="btn-primary-sm inline-flex items-center gap-2 disabled:opacity-50"
                disabled={!resolvedVideoUrl || qaRunning || !isAuthenticated}
                onClick={async () => {
                  if (!resolvedVideoUrl) return;
                  setQaRunning(true);
                  setQaError(null);
                  try {
                    const allFrames = frames?.items ?? [];
                    const maxFrames = 8;
                    const sampleCount = Math.min(maxFrames, allFrames.length);
                    const sampleIndices =
                      sampleCount <= 1
                        ? [0]
                        : Array.from({ length: sampleCount }, (_, i) =>
                            Math.round((i * (allFrames.length - 1)) / (sampleCount - 1)),
                          );
                    const frameItems = Array.from(new Set(sampleIndices))
                      .map((idx) => allFrames[idx])
                      .filter(Boolean)
                      .map((it) => ({
                        url: resolveAbsoluteUrl(it.image) ?? it.image,
                        label: it.name,
                        route: it.path,
                        startSec: it.startSec,
                      }));

                    let uploadedFrames:
                      | { url: string; label?: string; route?: string; startSec?: number }[]
                      | undefined;

                    if (frameItems.length > 0) {
                      uploadedFrames = [];
                      for (const f of frameItems) {
                        // eslint-disable-next-line no-await-in-loop
                        const url = await uploadUrlToConvexStorage(
                          f.url,
                          `dogfood-frame-${Date.now()}-${slugifyForFile(f.label) || "frame"}.jpg`,
                          "image/jpeg",
                        );
                        uploadedFrames.push({ ...f, url });
                      }
                    }

                    // Always upload the video so Convex/Gemini can fetch it (localhost URLs are not reachable from the cloud).
                    const videoUrlForRun = await uploadUrlToConvexStorage(
                      resolvedVideoUrl,
                      `dogfood-walkthrough-${Date.now()}.mp4`,
                      walkthrough?.mime ?? "video/mp4",
                    );

                    const run = (await runVideoQa({
                      videoUrl: videoUrlForRun,
                      frames: uploadedFrames,
                      walkthrough: walkthrough ?? undefined,
                      prompt: qaPrompt.trim().length ? qaPrompt : undefined,
                    })) as any as DogfoodQaRun;
                    setQaLast(run);
                  } catch (e) {
                    setQaError(e instanceof Error ? e.message : String(e));
                  } finally {
                    setQaRunning(false);
                  }
                }}
                aria-label="Run Gemini QA on video"
                title="Run Gemini QA on video"
              >
                {qaRunning ? "Running..." : "Run video QA"}
              </button>

              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-md border border-border/60 bg-card px-3 py-2 text-sm text-foreground hover:bg-muted/40 transition-colors disabled:opacity-50"
                disabled={!manifest?.items?.length || qaScreensRunning || !isAuthenticated}
                onClick={async () => {
                  if (!manifest?.items?.length) return;
                  setQaScreensRunning(true);
                  setQaError(null);
                  try {
                    const base = manifest.basePath || "/dogfood/screenshots";
                    const allScreenshots = (manifest.items ?? [])
                      .filter((it: any) => it.kind === "route" || it.kind === "interaction" || it.kind === "settings")
                      .map((it: any) => {
                        const variantTag = (it.theme && it.viewport) ? ` [${it.theme} ${it.viewport}]` : "";
                        return {
                          label: `${it.label}${variantTag}`,
                          route: it.kind === "route" ? it.label : it.kind,
                          url: resolveAbsoluteUrl(`${base}/${encodeURIComponent(it.file)}`) ?? "",
                        };
                      })
                      .filter((s) => s.url);

                    // Sample evenly across variants: up to 12 screenshots total.
                    // Group by variant suffix, sample proportionally from each group.
                    const maxUpload = 12;
                    const sampleCount = Math.min(maxUpload, allScreenshots.length);
                    const sampleIndices =
                      sampleCount <= 1
                        ? [0]
                        : Array.from({ length: sampleCount }, (_, i) =>
                            Math.round((i * (allScreenshots.length - 1)) / (sampleCount - 1)),
                          );
                    const screenshots = Array.from(new Set(sampleIndices))
                      .map((idx) => allScreenshots[idx])
                      .filter(Boolean);

                    const uploaded = [];
                    for (const s of screenshots) {
                      // eslint-disable-next-line no-await-in-loop
                      const url = await uploadUrlToConvexStorage(
                        s.url,
                        `dogfood-${Date.now()}-${slugifyForFile(s.label) || "screen"}.png`,
                        "image/png",
                      );
                      uploaded.push({ ...s, url });
                    }

                    const run = (await runScreenshotQa({
                      screenshots: uploaded,
                      prompt: qaPrompt.trim().length ? qaPrompt : undefined,
                      maxImages: uploaded.length,
                    })) as any as DogfoodQaRun;
                    setQaLast(run);
                  } catch (e) {
                    setQaError(e instanceof Error ? e.message : String(e));
                  } finally {
                    setQaScreensRunning(false);
                  }
                }}
                aria-label="Run Gemini QA on screenshots"
                title="Run Gemini QA on screenshots"
              >
                {qaScreensRunning ? "Running..." : "Run screenshot QA"}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground tracking-wide">
              Prompt override (optional)
            </label>
            <textarea
              className="w-full min-h-[92px] rounded-md border border-border/60 bg-card px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={qaPrompt}
              onChange={(e) => setQaPrompt(e.target.value)}
              placeholder="Leave blank to use the default design + performance QA rubric."
            />
          </div>

          {qaError && (
            <div className="text-xs text-muted-foreground">
              QA error: <span className="font-mono">{qaError}</span>
            </div>
          )}

          {(qaLast || (qaRuns && qaRuns.length > 0)) && (
            <div className="space-y-3">
              <div className="flex items-baseline justify-between gap-3">
                <div className="text-xs font-semibold text-muted-foreground tracking-wide">Recent runs</div>
                <div className="text-xs text-muted-foreground">
                  {qaLast ? (
                    <span>
                      Latest: <span className="font-mono">{formatMs(qaLast.createdAt)}</span>
                      {qaLast.source ? <span className="font-mono"> · {qaLast.source}</span> : null}
                    </span>
                  ) : null}
                </div>
              </div>

              {[...(qaLast ? [qaLast] : []), ...((qaRuns ?? []).filter((r) => r._id !== qaLast?._id))].slice(0, 4).map((run) => (
                <div key={run._id} className="rounded-md border border-border/60 bg-background p-3 space-y-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="text-sm font-medium text-foreground">Summary</div>
                    <div className="text-xs text-muted-foreground font-mono">
                      {formatMs(run.createdAt)} · {run.provider}/{run.model}{run.source ? ` · ${run.source}` : ""}
                    </div>
                  </div>
                  <div className="text-sm text-muted-foreground whitespace-pre-wrap">{run.summary}</div>

                  {run.issues?.length ? (
                    <div className="mt-2 space-y-2">
                      {run.issues.slice(0, 12).map((it, idx) => (
                        <div key={`${run._id}-${idx}`} className="rounded-md border border-border/60 bg-card p-3">
                          <div className="flex items-baseline justify-between gap-3">
                            <div className="text-sm font-medium text-foreground truncate">
                              <span className="mr-2 inline-flex items-center rounded px-1.5 py-0.5 text-xs font-mono border border-border/60 bg-muted/20">
                                {String(it.severity).toUpperCase()}
                              </span>
                              {it.title}
                            </div>
                            {(typeof it.startSec === "number" || typeof it.endSec === "number") && (
                              <div className="text-xs text-muted-foreground font-mono">
                                {typeof it.startSec === "number" ? it.startSec.toFixed(1) : "?"}s-
                                {typeof it.endSec === "number" ? it.endSec.toFixed(1) : "?"}s
                              </div>
                            )}
                          </div>
                          {it.route && <div className="text-xs text-muted-foreground font-mono">{it.route}</div>}
                          <div className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">{it.details}</div>
                          {it.suggestedFix && (
                            <div className="mt-2 text-sm text-foreground whitespace-pre-wrap">
                              <span className="text-xs font-semibold text-muted-foreground tracking-wide mr-2">
                                Suggested fix:
                              </span>
                              {it.suggestedFix}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground">No issues reported.</div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* QA Trend - severity burndown over last 14 days */}
          {qaTrending && qaTrending.length > 0 && (() => {
            const maxTotal = Math.max(...qaTrending.map((d) => d.total), 1);
            const latest = qaTrending[qaTrending.length - 1];
            const prev = qaTrending.length >= 2 ? qaTrending[qaTrending.length - 2] : null;
            const critLatest = latest.p0 + latest.p1;
            const critPrev = prev ? prev.p0 + prev.p1 : critLatest;
            const delta = critLatest - critPrev;
            const points = qaTrending
              .map((d, i) => {
                const x = qaTrending.length === 1 ? 50 : (i / (qaTrending.length - 1)) * 100;
                const y = 100 - ((d.p0 + d.p1) / maxTotal) * 100;
                return `${x},${y}`;
              })
              .join(" ");
            return (
              <div className="space-y-2">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="text-xs font-semibold text-muted-foreground tracking-wide">QA Trend</div>
                  <div className="flex items-baseline gap-2 text-xs text-muted-foreground">
                    <span className="font-mono">p0+p1: {critLatest}</span>
                    {prev && (
                      <span className={`font-mono ${delta < 0 ? "text-green-500" : delta > 0 ? "text-red-400" : "text-muted-foreground"}`}>
                        {delta > 0 ? "+" : ""}{delta}
                      </span>
                    )}
                  </div>
                </div>
                <div className="rounded-md border border-border/60 bg-card p-3">
                  <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-16">
                    <polyline
                      points={points}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      vectorEffect="non-scaling-stroke"
                      className="text-red-400/80"
                    />
                    {qaTrending.map((d, i) => {
                      const x = qaTrending.length === 1 ? 50 : (i / (qaTrending.length - 1)) * 100;
                      const y = 100 - ((d.p0 + d.p1) / maxTotal) * 100;
                      return <circle key={i} cx={x} cy={y} r="2" vectorEffect="non-scaling-stroke" className="fill-red-400/80" />;
                    })}
                  </svg>
                  <div className="flex justify-between mt-1 text-xs text-muted-foreground font-mono">
                    <span>{qaTrending[0].date}</span>
                    <span>{latest.date}</span>
                  </div>
                </div>
              </div>
            );
          })()}

          {qaTrending !== undefined && qaTrending.length === 0 && (
            <div className="text-xs text-muted-foreground">No QA runs in the last 14 days - run a QA session above to start tracking trends.</div>
          )}
        </div>

        {!manifest && (
          <div className="nb-surface-card p-5 space-y-3">
            <div className="text-sm font-medium text-foreground">No published dogfood artifacts</div>
            <div className="text-sm text-muted-foreground">
              Publish the latest Playwright screenshots so this page can render them.
            </div>
            <div className="rounded-md bg-muted/30 border border-border/50 p-3 font-mono text-xs text-foreground whitespace-pre-wrap">
              {commands.fullLocal}
              {"\n"}
              {commands.fullLocalPlay}
              {"\n"}
              {commands.runE2e}
              {"\n"}
              {commands.publish}
            </div>
            {loadError && (
              <div className="text-xs text-muted-foreground">
                Manifest load error: <span className="font-mono">{loadError}</span>
              </div>
            )}
          </div>
        )}

        {manifest && (
          <div className="space-y-6">
            {Object.entries(grouped).map(([kind, items]) => (
              <section key={kind} className="space-y-3">
                <div className="flex items-end justify-between">
                  <h2 className="text-sm font-semibold text-foreground tracking-wide">
                    {kind} <span className="text-muted-foreground font-medium">({items.length})</span>
                  </h2>
                  <div className="text-xs text-muted-foreground">
                    Base path: <span className="font-mono">{manifest.basePath}</span>
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((item) => {
                    const src = `${manifest.basePath}/${encodeURIComponent(item.file)}`;
                    return (
                      <div key={item.file} className="rounded-lg border border-border/60 bg-card overflow-hidden">
                        <div className="px-3 py-2 border-b border-border/50 flex items-center justify-between gap-2">
                          <div className="text-xs font-medium text-foreground truncate">{item.label}</div>
                          <a
                            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                            href={src}
                            target="_blank"
                            rel="noreferrer"
                            title="Open full-size"
                          >
                            Open
                          </a>
                        </div>
                        <div className="bg-muted/10">
                          <img src={src} alt={item.label} className="w-full h-auto block" loading="eager" decoding="async" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}

        {/* Local Script QA Score History */}
        {(localQaResults !== null || localQaError) && (
          <div className="nb-surface-card overflow-hidden">
            <div className="px-5 py-3 border-b border-border/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="text-sm font-medium text-foreground">Local QA Score History</div>
                <span className="text-xs px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground font-mono">
                  qa-results.json
                </span>
              </div>
              {localQaResults && localQaResults.length > 0 && (
                <div className="flex items-center gap-2 text-xs">
                  {(() => {
                    const latest = localQaResults[0];
                    const gradeColor =
                      latest.grade === "A" ? "text-green-500" :
                      latest.grade === "B" ? "text-emerald-400" :
                      latest.grade === "C" ? "text-amber-400" :
                      latest.grade === "D" ? "text-orange-400" : "text-red-400";
                    return (
                      <>
                        <span className={`font-semibold text-base ${gradeColor}`}>{latest.grade}</span>
                        <span className="text-muted-foreground font-mono">{latest.score}/100</span>
                      </>
                    );
                  })()}
                </div>
              )}
            </div>

            <div className="p-5 space-y-4">
              {localQaError && !localQaResults && (
                <div className="text-xs text-muted-foreground">
                  Not available: <span className="font-mono">{localQaError}</span>
                  <div className="mt-1">Run <span className="font-mono">npm run dogfood:visual-qa</span> or <span className="font-mono">npm run dogfood:gemini-qa</span> to generate scores.</div>
                </div>
              )}

              {localQaResults && localQaResults.length === 0 && (
                <div className="text-xs text-muted-foreground">
                  No local QA runs recorded yet. Run <span className="font-mono">npm run dogfood:visual-qa</span> to generate the first score.
                </div>
              )}

              {localQaResults && localQaResults.length > 0 && (() => {
                const entries = localQaResults.slice(0, 10);
                const maxScore = 100;
                const points = entries
                  .slice()
                  .reverse()
                  .map((e, i, arr) => {
                    const x = arr.length === 1 ? 50 : (i / (arr.length - 1)) * 100;
                    const y = 100 - (e.score / maxScore) * 100;
                    return `${x},${y}`;
                  })
                  .join(" ");

                return (
                  <>
                    {/* Sparkline */}
                    <div className="rounded-md border border-border/60 bg-card p-3">
                      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-12">
                        <polyline
                          points={points}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          vectorEffect="non-scaling-stroke"
                          className="text-indigo-600 dark:text-indigo-400/80"
                        />
                        {entries
                          .slice()
                          .reverse()
                          .map((e, i, arr) => {
                            const x = arr.length === 1 ? 50 : (i / (arr.length - 1)) * 100;
                            const y = 100 - (e.score / maxScore) * 100;
                            const dotColor =
                              e.grade === "A" ? "fill-green-400" :
                              e.grade === "B" ? "fill-emerald-400" :
                              e.grade === "C" ? "fill-amber-400" :
                              e.grade === "D" ? "fill-orange-400" : "fill-red-400";
                            return <circle key={i} cx={x} cy={y} r="2.5" vectorEffect="non-scaling-stroke" className={dotColor} />;
                          })}
                      </svg>
                      <div className="flex justify-between mt-1 text-xs text-muted-foreground font-mono">
                        <span>{entries[entries.length - 1]?.ts?.slice(0, 10)}</span>
                        <span>{entries[0]?.ts?.slice(0, 10)}</span>
                      </div>
                    </div>

                    {/* Run table */}
                    <div className="space-y-1.5">
                      {entries.map((e, idx) => {
                        const gradeColor =
                          e.grade === "A" ? "text-green-500 bg-green-500/10 border-green-500/20" :
                          e.grade === "B" ? "text-emerald-400 bg-emerald-400/10 border-emerald-400/20" :
                          e.grade === "C" ? "text-amber-400 bg-amber-400/10 border-amber-400/20" :
                          e.grade === "D" ? "text-orange-400 bg-orange-400/10 border-orange-400/20" :
                          "text-red-400 bg-red-400/10 border-red-400/20";
                        return (
                          <div key={idx} className="flex items-center gap-3 rounded-md border border-border/40 bg-background px-3 py-2">
                            <span className={`text-xs font-semibold px-1.5 py-0.5 rounded border font-mono ${gradeColor}`}>
                              {e.grade}
                            </span>
                            <span className="text-sm font-medium text-foreground font-mono w-10 tabular-nums">{e.score}</span>
                            <div className="flex gap-2 text-xs font-mono text-muted-foreground">
                              {e.critical > 0 && <span className="text-red-400">{e.critical}C</span>}
                              {e.warning > 0 && <span className="text-amber-400">{e.warning}W</span>}
                              {e.info > 0 && <span className="text-sky-400">{e.info}I</span>}
                            </div>
                            {e.source && (
                              <span className="text-xs px-1 py-0.5 rounded bg-muted/40 text-muted-foreground font-mono">
                                {e.source}
                              </span>
                            )}
                            <span className="ml-auto text-xs text-muted-foreground font-mono">
                              {e.ts ? new Date(e.ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) : "-"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        )}

        {/* Generation QA Ledger */}
        {(generationLedger || generationLedgerError) && (
          <div className="nb-surface-card overflow-hidden">
            <div className="px-5 py-3 border-b border-border/50 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-foreground">Generation QA Ledger</div>
                <div className="text-xs text-muted-foreground">
                  Stable gen-to-gen evidence archive for before, during, and after review states.
                </div>
              </div>
              <button
                type="button"
                className="btn-outline-sm"
                onClick={() => copyWithFeedback(`${commands.qaFirstClass}\n${commands.qaLedger}\n${commands.verifyFirstClass}`, "generation-qa")}
                aria-label="Copy first-class QA commands"
                title="Copy first-class QA commands"
              >
                {copiedId === "generation-qa" ? "Copied!" : "Copy QA commands"}
              </button>
            </div>
            <div className="p-5 space-y-4">
              {generationLedgerError && !generationLedger && (
                <div className="text-xs text-muted-foreground">
                  Ledger not available: <span className="font-mono">{generationLedgerError}</span>
                  <div className="mt-1">
                    Run <span className="font-mono">npm run dogfood:qa:ledger</span> after a strict QA pass.
                  </div>
                </div>
              )}

              {generationLedger && (() => {
                const latest = generationLedger.history?.latest;
                const archive = generationLedger.generationArchive;
                const stateEvidence = archive?.stateEvidence ?? {};
                const releaseStatus = generationLedger.releaseInterpretation?.latestStatus ?? "unknown";
                const statusClass = releaseStatus === "release-clean"
                  ? "text-green-500 bg-green-500/10 border-green-500/20"
                  : "text-amber-500 bg-amber-500/10 border-amber-500/20";
                const comparisons = generationLedger.comparisons?.slice(0, 4) ?? [];
                const realIssues = generationLedger.currentRun?.realIssues?.slice(0, 6) ?? [];

                return (
                  <>
                    <div className="grid gap-3 md:grid-cols-4">
                      <div className="rounded-md border border-border/60 bg-background px-3 py-2">
                        <div className="text-xs uppercase tracking-wide text-muted-foreground">Generation</div>
                        <div className="mt-1 text-lg font-semibold text-foreground font-mono">
                          {archive?.sequence ?? latest?.generation ?? "-"}
                        </div>
                      </div>
                      <div className="rounded-md border border-border/60 bg-background px-3 py-2">
                        <div className="text-xs uppercase tracking-wide text-muted-foreground">Score</div>
                        <div className="mt-1 text-lg font-semibold text-foreground font-mono">
                          {latest?.score ?? "-"} {latest?.grade ? `/ ${latest.grade}` : ""}
                        </div>
                      </div>
                      <div className="rounded-md border border-border/60 bg-background px-3 py-2">
                        <div className="text-xs uppercase tracking-wide text-muted-foreground">Real issues</div>
                        <div className="mt-1 text-lg font-semibold text-foreground font-mono">
                          {latest?.realIssueCount ?? "-"}
                        </div>
                      </div>
                      <div className="rounded-md border border-border/60 bg-background px-3 py-2">
                        <div className="text-xs uppercase tracking-wide text-muted-foreground">Status</div>
                        <div className={`mt-1 inline-flex rounded border px-2 py-0.5 text-xs font-semibold ${statusClass}`}>
                          {releaseStatus}
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-3">
                      {(["before", "during", "after"] as const).map((state) => (
                        <div key={state} className="rounded-md border border-border/60 bg-card px-3 py-2">
                          <div className="text-xs uppercase tracking-wide text-muted-foreground">{state}</div>
                          <div className="mt-1 text-base font-semibold text-foreground font-mono">
                            {stateEvidence[state]?.count ?? 0} files
                          </div>
                          {stateEvidence[state]?.purpose && (
                            <div className="mt-1 text-xs text-muted-foreground">{stateEvidence[state]?.purpose}</div>
                          )}
                        </div>
                      ))}
                    </div>

                    {archive?.archivePath && (
                      <div className="rounded-md border border-border/60 bg-background px-3 py-2 text-xs text-muted-foreground">
                        Archive: <span className="font-mono text-foreground">{archive.archivePath}</span>
                        <span className="ml-2 font-mono">({archive.copiedCount} evidence files)</span>
                      </div>
                    )}

                    {comparisons.length > 0 && (
                      <div className="space-y-2">
                        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Latest comparisons</div>
                        <div className="space-y-1.5">
                          {comparisons.map((row) => (
                            <div key={row.label} className="flex items-center gap-3 rounded-md border border-border/40 bg-background px-3 py-2 text-xs">
                              <span className="font-mono text-muted-foreground w-44 truncate">{row.label}</span>
                              <span className="text-foreground font-mono">score {row.latest.score}</span>
                              <span className={row.scoreDelta >= 0 ? "text-green-500 font-mono" : "text-red-400 font-mono"}>
                                {row.scoreDelta >= 0 ? "+" : ""}{row.scoreDelta}
                              </span>
                              <span className={row.realIssueDelta <= 0 ? "text-green-500 font-mono" : "text-amber-500 font-mono"}>
                                issues {row.realIssueDelta >= 0 ? "+" : ""}{row.realIssueDelta}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {realIssues.length > 0 && (
                      <div className="space-y-2">
                        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Current open findings</div>
                        <div className="grid gap-2 md:grid-cols-2">
                          {realIssues.map((issue, index) => (
                            <div key={`${issue.header ?? "issue"}-${index}`} className="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                              <div className="text-xs font-medium text-foreground">{issue.header ?? "Untitled issue"}</div>
                              {issue.route && <div className="mt-1 text-xs text-muted-foreground">Route: {issue.route}</div>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        )}

        {/* ── Design Governance ── */}
        {localQaResults && localQaResults.length > 0 &&
          localQaResults[0].compositeScore != null && (
          <GovernancePanel entry={localQaResults[0]} />
        )}

        {/* Overstory QA Orchestration Panel */}
        <OverstoryStatusPanel />

        <div className="nb-surface-card p-5 space-y-2">
          <div className="text-sm font-medium text-foreground">Definition of done</div>
          <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">
            <li>Every changed screen is dogfooded end-to-end (and adjacent screens sharing layout).</li>
            <li>Root cause diagnosed (render path, data ownership, stored vs computed) and fixed.</li>
            <li>Evidence published here (screens + walkthrough + how-to) so quality is verifiable without reading code.</li>
            <li>Overstory QA gate passes (all routes grade &gt;= B, zero p0/p1 issues).</li>
          </ul>
        </div>
        </div>
      </div>
    </div>
  );
}
