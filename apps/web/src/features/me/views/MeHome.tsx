import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { BookOpen, FileText, Plus, Save, Upload } from "lucide-react";
import { toast } from "sonner";
import { useConvexApi } from "@/lib/convexApi";
import { buildCockpitPath } from "@/lib/registry/viewRegistry";
import MobileMeSurface from "@/features/me/views/MobileMeSurface";
import { usePwaInstallPrompt } from "@/hooks/usePwaInstallPrompt";
import { getAnonymousProductSessionId } from "@/features/product/lib/productIdentity";
import { useProductBootstrap } from "@/features/product/lib/useProductBootstrap";
import {
  buildOperatorContextHint,
  normalizeRolesOfInterest,
  rolesOfInterestToText,
  type OperatorCommunicationStyle,
  type OperatorEvidenceStyle,
} from "@/features/product/lib/operatorContext";

/* ------------------------------------------------------------------ */
/*  Shared input classes                                               */
/* ------------------------------------------------------------------ */

const INPUT_CLS =
  "mt-1.5 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-[var(--accent-primary)] focus:ring-1 focus:ring-[var(--accent-primary)] dark:border-white/10 dark:bg-white/[0.03] dark:text-gray-100 dark:placeholder:text-gray-500";

const LABEL_CLS = "block text-sm font-medium text-gray-700 dark:text-gray-300";

const DIVIDER = "border-t border-gray-100 dark:border-white/[0.06]";

type ChoiceOption<T extends string> = {
  label: string;
  value: T;
};

type VaultFilter = "all" | "documents" | "images" | "videos" | "audio" | "code";

type VaultFile = {
  _id: string;
  label?: string;
  type?: string;
  mimeType?: string;
  size?: number | null;
  storageUrl?: string | null;
  updatedAt?: number;
};

type NotebookEntity = {
  id: string;
  name: string;
  tag: string;
  reports: number;
  changes: number;
  lastActivity: string;
};

function formatFileSize(size?: number | null) {
  if (!size || !Number.isFinite(size)) return null;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRelativeTime(timestamp?: number | null) {
  if (!timestamp) return "just now";
  const minutes = Math.max(1, Math.round((Date.now() - timestamp) / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function getVaultCategory(file: VaultFile): Exclude<VaultFilter, "all"> {
  const mime = String(file.mimeType ?? "").toLowerCase();
  const label = String(file.label ?? "").toLowerCase();
  const type = String(file.type ?? "").toLowerCase();
  if (type === "image" || mime.startsWith("image/")) return "images";
  if (type === "voice" || mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "videos";
  if (/\.(tsx?|jsx?|json|ya?ml|md|py|rb|go|rs|java|swift|kt|sql|sh|css|html?)$/.test(label)) {
    return "code";
  }
  return "documents";
}

function ChoiceButtonGroup<T extends string>({
  id,
  name,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  name: string;
  label: string;
  value: T;
  options: ChoiceOption<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <label className="block">
      <span id={`${id}-label`} className={LABEL_CLS}>
        {label}
      </span>
      <input id={id} name={name} type="hidden" value={value} />
      <div
        role="radiogroup"
        aria-labelledby={`${id}-label`}
        className="mt-1.5 flex flex-wrap gap-2"
      >
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              data-state={active ? "active" : "inactive"}
              onClick={() => onChange(option.value)}
              className={`inline-flex min-h-[40px] items-center rounded-full border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]/40 ${
                active
                  ? "border-[var(--accent-primary)]/25 bg-[var(--accent-primary)]/12 text-[var(--accent-primary)] dark:border-[var(--accent-primary)]/35 dark:bg-[var(--accent-primary)]/18 dark:text-white"
                  : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:text-gray-900 dark:border-white/10 dark:bg-white/[0.03] dark:text-gray-300 dark:hover:border-white/[0.18] dark:hover:text-gray-100"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </label>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function MeHome() {
  useProductBootstrap();

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sectionParam = searchParams.get("section");
  const api = useConvexApi();
  const anonymousSessionId = getAnonymousProductSessionId();
  const { canInstall, isInstalled, promptToInstall } = usePwaInstallPrompt();

  // ── Queries ──
  const snapshot = useQuery(
    api?.domains.product.me.getMeSnapshot ?? "skip",
    api?.domains.product.me.getMeSnapshot ? { anonymousSessionId } : "skip",
  );
  const nudgesSnapshot = useQuery(
    api?.domains.product.nudges.getNudgesSnapshot ?? "skip",
    api?.domains.product.nudges.getNudgesSnapshot ? { anonymousSessionId } : "skip",
  );

  // ── Mutations ──
  const generateUploadUrl = useMutation(api?.domains.product.me.generateUploadUrl ?? ("skip" as any));
  const saveFileMutation = useMutation(api?.domains.product.me.saveFile ?? ("skip" as any));
  const updateProfileMutation = useMutation(api?.domains.product.me.updateProfile ?? ("skip" as any));
  const realFiles = useQuery(
    api?.domains.product.me.listFiles ?? "skip",
    api?.domains.product.me.listFiles ? { anonymousSessionId } : "skip",
  );

  // ── Refs ──
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hydratedKeyRef = useRef<string | null>(null);

  // ── Local state ──
  const [profileDraft, setProfileDraft] = useState("");
  const [rolesDraft, setRolesDraft] = useState("");
  const [lensDraft, setLensDraft] = useState("founder");
  const [commStyle, setCommStyle] = useState<OperatorCommunicationStyle>("balanced");
  const [evidenceStyle, setEvidenceStyle] = useState<OperatorEvidenceStyle>("balanced");
  const [avoidCorporate, setAvoidCorporate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [fileFilter, setFileFilter] = useState<VaultFilter>("all");

  const lensOptions: ChoiceOption<string>[] = [
    { label: "Founder", value: "founder" },
    { label: "Investor", value: "investor" },
    { label: "Banker", value: "banker" },
    { label: "CEO", value: "ceo" },
    { label: "Legal", value: "legal" },
    { label: "Student", value: "student" },
  ];
  const communicationOptions: ChoiceOption<OperatorCommunicationStyle>[] = [
    { label: "Concise", value: "concise" },
    { label: "Balanced", value: "balanced" },
    { label: "Detailed", value: "detailed" },
  ];
  const evidenceOptions: ChoiceOption<OperatorEvidenceStyle>[] = [
    { label: "Fast", value: "fast" },
    { label: "Balanced", value: "balanced" },
    { label: "Citation heavy", value: "citation_heavy" },
  ];

  // ── Derived ──
  const profile = snapshot?.profile;
  const bgSummary = typeof profile?.backgroundSummary === "string" ? profile.backgroundSummary.trim() : "";
  const savedRoles = Array.isArray(profile?.rolesOfInterest) ? profile.rolesOfInterest : [];

  const fileVault = (realFiles ?? []) as VaultFile[];
  const fileCounts = useMemo(() => {
    const counts: Record<VaultFilter, number> = {
      all: fileVault.length,
      documents: 0,
      images: 0,
      videos: 0,
      audio: 0,
      code: 0,
    };
    for (const file of fileVault) {
      counts[getVaultCategory(file)] += 1;
    }
    return counts;
  }, [fileVault]);
  const filteredFiles = useMemo(() => {
    if (fileFilter === "all") return fileVault;
    return fileVault.filter((file) => getVaultCategory(file) === fileFilter);
  }, [fileFilter, fileVault]);

  const savedContext = snapshot?.savedContext ?? [];
  const contextTotal = savedContext.reduce((sum: number, i: any) => sum + Number(i.value || 0), 0);
  const notebookEntities = useMemo<NotebookEntity[]>(() => {
    const contextValue = (label: string) =>
      Number(savedContext.find((item: any) => String(item.label).toLowerCase() === label)?.value ?? 0);
    const companies = contextValue("companies");
    const reports = contextValue("reports");
    const people = contextValue("people");

    return [
      {
        id: "operator-context",
        name: "Operator context",
        tag: lensDraft,
        reports: Math.max(reports, 1),
        changes: Math.max(1, Math.min(6, contextTotal || 1)),
        lastActivity: "Live",
      },
      {
        id: "company-watchlist",
        name: "Company watchlist",
        tag: evidenceStyle,
        reports: Math.max(companies, 1),
        changes: Math.max(0, Math.min(5, companies)),
        lastActivity: "Today",
      },
      {
        id: "relationship-trail",
        name: "Relationship trail",
        tag: "people",
        reports: Math.max(people, 1),
        changes: Math.max(0, Math.min(4, people)),
        lastActivity: "This week",
      },
    ];
  }, [contextTotal, evidenceStyle, lensDraft, savedContext]);

  const connectors = useMemo(
    () =>
      nudgesSnapshot?.channels?.length
        ? nudgesSnapshot.channels
        : [
            { label: "Slack", status: "Not connected" },
            { label: "Gmail", status: "Not connected" },
            { label: "Notion", status: "Not connected" },
            { label: "Linear", status: "Not connected" },
          ],
    [nudgesSnapshot?.channels],
  );

  // ── Hydrate profile draft from server ──
  const hydratedKey = useMemo(
    () => JSON.stringify({ bgSummary, lens: profile?.preferredLens, roles: savedRoles, comm: profile?.preferences?.communicationStyle, ev: profile?.preferences?.evidenceStyle, corp: profile?.preferences?.avoidCorporateTone }),
    [bgSummary, profile?.preferences?.avoidCorporateTone, profile?.preferences?.communicationStyle, profile?.preferences?.evidenceStyle, profile?.preferredLens, savedRoles],
  );

  useEffect(() => {
    if (typeof window === "undefined" || !sectionParam) return;
    const targetId = sectionParam === "files" ? "me-files" : null;
    if (!targetId) return;
    let cancelled = false;
    const deadline = Date.now() + 3000;
    const attempt = () => {
      if (cancelled) return;
      const el = document.getElementById(targetId);
      if (el) {
        el.scrollIntoView({ behavior: "auto", block: "start" });
        window.setTimeout(() => {
          const stillThere = document.getElementById(targetId);
          if (stillThere) stillThere.scrollIntoView({ behavior: "auto", block: "start" });
        }, 400);
        return;
      }
      if (Date.now() < deadline) {
        window.setTimeout(attempt, 120);
      }
    };
    window.setTimeout(attempt, 120);
    return () => {
      cancelled = true;
    };
  }, [sectionParam]);

  useEffect(() => {
    if (hydratedKeyRef.current === hydratedKey) return;
    hydratedKeyRef.current = hydratedKey;
    setProfileDraft(bgSummary);
    setRolesDraft(rolesOfInterestToText(savedRoles));
    setLensDraft(profile?.preferredLens ?? "founder");
    setCommStyle(profile?.preferences?.communicationStyle ?? "balanced");
    setEvidenceStyle(profile?.preferences?.evidenceStyle ?? "balanced");
    setAvoidCorporate(Boolean(profile?.preferences?.avoidCorporateTone));
    setNotice(null);
  }, [bgSummary, hydratedKey, profile?.preferredLens, profile?.preferences?.avoidCorporateTone, profile?.preferences?.communicationStyle, profile?.preferences?.evidenceStyle, savedRoles]);

  // ── Handlers ──
  const handleUpload = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file || !api) return;
      setUploadingFile(true);
      try {
        const uploadUrl = await generateUploadUrl();
        const res = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": file.type }, body: file });
        const { storageId } = await res.json();
        await saveFileMutation({ anonymousSessionId, storageId, name: file.name, mimeType: file.type, size: file.size });
        setNotice("Saved to Files.");
      } catch (err) {
        console.error("[Me] upload failed", err);
        setNotice("Upload failed.");
      } finally {
        setUploadingFile(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [anonymousSessionId, api, generateUploadUrl, saveFileMutation],
  );

  const saveProfile = useCallback(async () => {
    setSaving(true);
    setNotice(null);
    try {
      await updateProfileMutation({
        anonymousSessionId,
        backgroundSummary: profileDraft.trim(),
        preferredLens: lensDraft,
        rolesOfInterest: normalizeRolesOfInterest(rolesDraft),
        preferences: { communicationStyle: commStyle, evidenceStyle, avoidCorporateTone: avoidCorporate },
      });
      setNotice("Saved.");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }, [anonymousSessionId, avoidCorporate, commStyle, evidenceStyle, lensDraft, profileDraft, rolesDraft, updateProfileMutation]);

  const handleInstallApp = useCallback(async () => {
    const result = await promptToInstall();
    if (result.outcome === "accepted") {
      setNotice("NodeBench installed.");
      return;
    }
    setNotice("Install dismissed.");
  }, [promptToInstall]);

  // ── Render ──
  return (
    <>
      {/* Mobile-only Me surface (ported from nodebench-mobile design kit) */}
      <MobileMeSurface />

      {/* Desktop Me surface — hidden on mobile */}
      <div className="hidden md:block mx-auto max-w-[720px] px-6 py-8 pb-24">

      {/* ── Header ── kit parity: ui_kits/nodebench-web/EntityNotebook.jsx (MePage) */}
      <header>
        <h1 className="text-[28px] font-bold tracking-[-0.02em] text-content">Your context</h1>
        <p className="mt-1 max-w-[60ch] text-sm leading-6 text-content-muted">
          How you appear inside NodeBench, plus the entities you've taught it to watch.
          Reports and Inbox items anchor to these.
        </p>
      </header>

      {/*
        Section jump-nav — kit parity for the Me sidenav.  Live MeHome is
        single-page stacked rather than 2-pane sidenav-driven, so this gives
        the kit's nav affordance via anchor scrolls without restructuring
        the section state machinery.  Pill style matches the Inbox / Reports
        filter pill row landed in PR #73.
      */}
      <nav
        aria-label="Jump to section"
        className="mt-5 -mx-2 flex flex-wrap gap-1 overflow-x-auto rounded-full border border-black/[0.06] bg-black/[0.03] p-1 text-xs dark:border-white/10 dark:bg-white/[0.03] sm:mx-0"
      >
        {[
          ["me-notebook", "Memory"],
          ["me-profile", "Profile"],
          ["me-files", "Files"],
          ["me-plan", "Plan"],
          ["me-saved-context", "Data & memory"],
          ["me-connectors", "Integrations"],
          ["me-privacy", "Privacy"],
        ].map(([anchor, label]) => (
          <a
            key={anchor}
            href={`#${anchor}`}
            className="inline-flex items-center whitespace-nowrap rounded-full px-3 py-1.5 font-medium text-content-muted transition hover:bg-white/60 hover:text-content dark:hover:bg-white/[0.06]"
          >
            {label}
          </a>
        ))}
      </nav>

      {/* ── Hero: How NodeBench sees you ── */}
      <section className="mt-6 rounded-2xl border border-gray-200 bg-gray-50/60 p-5 dark:border-white/[0.08] dark:bg-white/[0.02]">
        <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400">
          <span className="h-1.5 w-1.5 rounded-full bg-gray-400 dark:bg-gray-500" aria-hidden="true" />
          How NodeBench sees you
        </div>
        <p className="mt-3 text-sm leading-6 text-gray-700 dark:text-gray-200">
          You're a <span className="font-semibold text-gray-900 dark:text-gray-100">{lensDraft.charAt(0).toUpperCase() + lensDraft.slice(1)}</span>.
          Answers use <span className="font-semibold text-gray-900 dark:text-gray-100">{commStyle}</span> style
          and <span className="font-semibold text-gray-900 dark:text-gray-100">{evidenceStyle}</span> evidence.
          {profileDraft.trim() ? " Your background shapes every run." : " Add a background summary below to sharpen every answer."}
        </p>
      </section>

      {/* Memory section */}
      <section id="me-notebook" className="mt-6 scroll-mt-24 rounded-2xl border border-gray-200 bg-white p-5 dark:border-white/[0.08] dark:bg-white/[0.02]">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--accent-primary)]">
              <BookOpen className="h-4 w-4" aria-hidden="true" />
              Memory
            </div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Watched memory</h2>
            <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
              Entities NodeBench can reuse across reports, inbox triage, and workspace handoffs.
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              navigate(
                buildCockpitPath({
                  surfaceId: "workspace",
                  extra: {
                    q: "Add a watched entity to my NodeBench memory.",
                    lens: lensDraft,
                  },
                }),
              )
            }
            className="inline-flex items-center gap-2 rounded-full border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition hover:border-[var(--accent-primary)]/35 hover:text-gray-900 dark:border-white/10 dark:text-gray-200 dark:hover:border-[var(--accent-primary)]/35"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add entity
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {notebookEntities.map((entity) => (
            <article
              key={entity.id}
              className="rounded-2xl border border-gray-200 bg-gray-50/60 p-4 dark:border-white/[0.08] dark:bg-white/[0.03]"
            >
              <div className="mb-4 flex items-start justify-between gap-3">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]">
                  <FileText className="h-4 w-4" aria-hidden="true" />
                </span>
              </div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{entity.name}</h3>
              <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
                {entity.tag}
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500 dark:text-gray-400">
                <span>{entity.reports} reports</span>
                <span>{entity.changes} changes</span>
                <span>{entity.lastActivity}</span>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 dark:border-white/[0.08] dark:bg-white/[0.02]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Install NodeBench</h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Add NodeBench to your home screen for faster launch and offline access.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleInstallApp()}
            disabled={!canInstall || isInstalled}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-white/[0.03] dark:text-gray-200 dark:hover:bg-white/[0.06]"
          >
            {isInstalled ? "Installed" : "Add to home screen"}
          </button>
        </div>
      </section>

      <section id="me-profile" className="mt-8 scroll-mt-24">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Profile</h2>
        <div className={`mt-6 ${DIVIDER}`} />

        <div className="mt-6 space-y-5">
          <label className="block">
            <span className={LABEL_CLS}>Background summary</span>
            <textarea
              id="me-background-summary"
              name="backgroundSummary"
              value={profileDraft}
              onChange={(e) => setProfileDraft(e.target.value)}
              rows={4}
              placeholder="What should NodeBench know about your workflow, stakeholders, or current priorities?"
              className={INPUT_CLS}
            />
          </label>

          <label className="block">
            <span className={LABEL_CLS}>Roles you care about</span>
            <input
              id="me-roles-of-interest"
              name="rolesOfInterest"
              value={rolesDraft}
              onChange={(e) => setRolesDraft(e.target.value)}
              placeholder="Founder, investor, recruiter"
              className={INPUT_CLS}
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <ChoiceButtonGroup
              id="me-preferred-lens"
              name="preferredLens"
              label="Preferred lens"
              value={lensDraft}
              options={lensOptions}
              onChange={setLensDraft}
            />

            <ChoiceButtonGroup
              id="me-communication-style"
              name="communicationStyle"
              label="Communication style"
              value={commStyle}
              options={communicationOptions}
              onChange={setCommStyle}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <ChoiceButtonGroup
              id="me-evidence-style"
              name="evidenceStyle"
              label="Evidence mode"
              value={evidenceStyle}
              options={evidenceOptions}
              onChange={setEvidenceStyle}
            />

            <label className="flex items-center gap-3 self-end rounded-lg px-1 py-2">
              <input
                id="me-avoid-corporate-tone"
                name="avoidCorporateTone"
                type="checkbox"
                checked={avoidCorporate}
                onChange={(e) => setAvoidCorporate(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-[var(--accent-primary)] focus:ring-[var(--accent-primary)]"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">Avoid corporate tone</span>
            </label>
          </div>
        </div>

        {/* Save */}
        <div className="mt-6 flex items-center gap-3">
          <button
            type="button"
            onClick={() => void saveProfile()}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--accent-primary)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--accent-primary-hover)] disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {saving ? "Saving..." : "Save preferences"}
          </button>
          {notice && <span className="text-sm text-gray-500">{notice}</span>}
        </div>
      </section>

      {/* ── Files section ── */}
      <section id="me-files" className="mt-10 scroll-mt-20">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Files</h2>
        <div className={`mt-3 ${DIVIDER}`} />

        <input
          ref={fileInputRef}
          id="me-upload-file"
          name="uploadFile"
          type="file"
          className="hidden"
          onChange={handleUpload}
          aria-label="Upload file"
        />

        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {fileCounts.all} file{fileCounts.all !== 1 ? "s" : ""} in your vault
          </span>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingFile}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 transition hover:bg-gray-50 dark:border-white/10 dark:bg-white/[0.03] dark:text-gray-300 dark:hover:bg-white/[0.06]"
          >
            <Upload className="h-3.5 w-3.5" />
            {uploadingFile ? "Uploading..." : "Upload"}
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {([
            ["all", `All ${fileCounts.all}`],
            ["documents", `Documents ${fileCounts.documents}`],
            ["images", `Images ${fileCounts.images}`],
            ["videos", `Videos ${fileCounts.videos}`],
            ["audio", `Audio ${fileCounts.audio}`],
            ["code", `Code ${fileCounts.code}`],
          ] as Array<[VaultFilter, string]>).map(([filter, label]) => {
            const active = fileFilter === filter;
            return (
              <button
                key={filter}
                type="button"
                onClick={() => setFileFilter(filter)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]/30 ${
                  active
                    ? "border-gray-300 bg-white text-gray-900 shadow-sm dark:border-white/[0.18] dark:bg-white/[0.08] dark:text-gray-50"
                    : "border-transparent text-gray-500 hover:border-gray-200 hover:text-gray-900 dark:text-gray-400 dark:hover:border-white/[0.12] dark:hover:text-gray-100"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {filteredFiles.length > 0 ? (
          <div className="mt-4 space-y-3">
            {filteredFiles.map((file) => (
              <article
                key={file._id}
                className="rounded-2xl border border-gray-200 bg-white px-4 py-4 dark:border-white/[0.08] dark:bg-white/[0.02]"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
                      {file.label || "Untitled file"}
                    </h3>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-gray-500 dark:text-gray-400">
                      <span className="capitalize">{getVaultCategory(file)}</span>
                      {file.mimeType ? <span>{file.mimeType}</span> : null}
                      {formatFileSize(file.size) ? <span>{formatFileSize(file.size)}</span> : null}
                      <span>Updated {formatRelativeTime(file.updatedAt)}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {file.storageUrl ? (
                      <button
                        type="button"
                        onClick={() => window.open(file.storageUrl!, "_blank", "noopener,noreferrer")}
                        className="rounded-full border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:border-gray-300 hover:text-gray-900 dark:border-white/[0.08] dark:text-gray-300 dark:hover:border-white/[0.16] dark:hover:text-gray-100"
                      >
                        View
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() =>
                        navigate(
                          buildCockpitPath({
                            surfaceId: "workspace",
                            extra: {
                              q: `Use my file ${file.label || "from Files"} and tell me what matters.`,
                              lens: lensDraft,
                            },
                          }),
                        )
                      }
                      className="rounded-full bg-[var(--accent-primary)] px-3 py-1.5 text-xs font-medium text-white transition hover:bg-[var(--accent-primary-hover)]"
                    >
                      Ask in Chat
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-dashed border-gray-200 bg-gray-50/60 px-4 py-4 dark:border-white/[0.08] dark:bg-white/[0.02]">
            <p className="text-sm leading-6 text-gray-600 dark:text-gray-300">
              {fileCounts.all === 0
                ? "No files yet. Upload once here or from Chat, then reuse them anywhere."
                : "No files match this filter yet."}
            </p>
          </div>
        )}
      </section>

      {/* ── Plan & Credits section ── */}
      <section id="me-plan" className="mt-10 scroll-mt-24" aria-labelledby="me-plan-heading">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="me-plan-heading" className="text-base font-semibold text-gray-900 dark:text-gray-100">
            Plan & Credits
          </h2>
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400">
            Free
          </span>
        </div>
        <div className={`mt-3 ${DIVIDER}`} />

        <div className="mt-4 grid grid-cols-3 gap-2 sm:gap-3">
          <PlanMetric label="Free credits" value="200" hint="Resets monthly" />
          <PlanMetric label="Used today" value="0" hint="Resets at 00:00 UTC" />
          <PlanMetric label="Streak" value="1d" hint="Keep the flywheel going" />
        </div>

        <p className="mt-3 text-xs leading-5 text-gray-500 dark:text-gray-400">
          You're on the free tier. Pro unlocks larger context windows, slow-profile agents, and unlimited parallel runs.
        </p>

        <button
          type="button"
          onClick={() => toast.message("Pro tier launching soon — we'll email you when it opens.")}
          className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[var(--accent-primary)] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--accent-primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]/40"
        >
          Upgrade to Pro
        </button>
      </section>

      {/* ── Saved context section ── */}
      <section id="me-saved-context" className="mt-10 scroll-mt-24">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Saved context</h2>
        <div className={`mt-3 ${DIVIDER}`} />

        {savedContext.length > 0 && savedContext.some((item: any) => String(item.value) !== "0" && Number(item.value) !== 0) ? (
          <div className="mt-4 space-y-2">
            {savedContext.map((item: any) => (
              <div key={item.label} className="flex items-center justify-between py-2">
                <span className="text-sm text-gray-700 dark:text-gray-300">{item.label}</span>
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{item.value}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-dashed border-gray-200 bg-gray-50/60 px-4 py-4 dark:border-white/[0.08] dark:bg-white/[0.02]">
            <p className="text-sm leading-6 text-gray-600 dark:text-gray-300">
              Nothing saved yet. Start a run on Home — every report you keep becomes context for the next one.
            </p>
            <button
              type="button"
              onClick={() => navigate(buildCockpitPath({ surfaceId: "ask" }))}
              className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:border-gray-300 dark:border-white/[0.1] dark:bg-white/[0.04] dark:text-gray-200 dark:hover:border-white/[0.2]"
            >
              Go to Chat
            </button>
          </div>
        )}
      </section>

      {/* ── Connectors section ── */}
      <section id="me-connectors" className="mt-10 scroll-mt-24">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Connectors</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Connect services to power Inbox and saved context.
        </p>
        <div className={`mt-4 ${DIVIDER}`} />

        <div className="mt-4 space-y-3">
          {connectors.map((c) => (
            <div key={c.label} className="flex items-center justify-between py-2">
              <div>
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{c.label}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">Inbox and saved context</div>
              </div>
              {c.status === "Connected" ? (
                <span className="rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700 dark:bg-green-500/10 dark:text-green-400">Connected</span>
              ) : (
                <button
                  type="button"
                  onClick={() => navigate(buildCockpitPath({ surfaceId: "workspace", extra: { q: `Help me connect ${c.label}`, lens: lensDraft } }))}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50 dark:border-white/10 dark:text-gray-400 dark:hover:bg-white/[0.04]"
                >
                  Connect
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ── Privacy section ── */}
      <section id="me-privacy" className="mt-10 scroll-mt-24 pb-8">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Privacy</h2>
        <div className={`mt-4 ${DIVIDER}`} />
        <div className="mt-4 space-y-3">
          <div className="py-2">
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">What Chat can use</div>
            <div className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">Files, reports, and profile when they improve the answer.</div>
          </div>
          <div className="py-2">
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">What stays private</div>
            <div className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">Source files stay private until a run explicitly references them.</div>
          </div>
        </div>
      </section>
      </div>
    </>
  );
}

function PlanMetric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-[18px] border border-gray-200 bg-white/80 px-3 py-3 dark:border-white/[0.08] dark:bg-white/[0.02]">
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
        {label}
      </div>
      <div className="mt-1 text-[22px] font-semibold leading-none tracking-[-0.01em] text-gray-900 dark:text-gray-50">
        {value}
      </div>
      {hint ? (
        <div className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">{hint}</div>
      ) : null}
    </div>
  );
}

export default MeHome;
