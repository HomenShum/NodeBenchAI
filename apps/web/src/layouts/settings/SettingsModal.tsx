import React, { useMemo, useState, useEffect } from "react";
import { useThemeSafe } from "../../contexts/ThemeContext";
import { useQuery, useMutation, useAction} from "convex/react";
import { useConvexApi } from "@/lib/convexApi";
import { toast } from "sonner";
import { Checkbox } from "@/components/ai-ui/checkbox";
import { Switch } from "@/components/ai-ui/switch";
import { WebMcpSettingsPanel } from "./WebMcpSettingsPanel";
import { useAuthActions } from "@convex-dev/auth/react";
import {
  X,
  Settings as SettingsIcon,
  Shield,
  BarChart2,
  Key,
  ArrowUpRight,
  Download,
  CheckCircle,
  Eye,
  EyeOff,
  Trash2,
  User,
  Mail,
  Calendar,
  Link,
  Zap,
  MessageSquare,
  Github,
  Slack,
  Webhook,
  Phone,
  LogOut,
  Layout,
} from "lucide-react";
import { ApiUsageDisplay } from "../../features/admin/components/ApiUsageDisplay";
import { NotificationActivityPanel } from "../../features/agents/components/NotificationActivityPanel";
import { AgentResilienceConnector } from "../../features/chat/components/AgentResilienceConnector";
import { ThemeCustomizer } from "./ThemeCustomizer";
import { DialogOverlay } from "@/shared/components/DialogOverlay";
import { useTheme } from "../../contexts/ThemeContext";
import type { LayoutMode } from "../../types/theme";
// ChannelPreferencesTab, OperatorProfileWizard, BatchAutopilotTab — moved to standalone Autopilot view

/** Layout mode toggle — retained as a cockpit-only compatibility control. */
function LayoutModeToggle() {
  const { setLayout } = useTheme();
  const options: { value: LayoutMode; label: string; desc: string }[] = [
    { value: "cockpit", label: "Workspace", desc: "Canonical persistent shell" },
  ];
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-content">Layout</h3>
      <div className="rounded-lg border border-edge bg-surface p-4">
        <div className="text-xs text-content-secondary mb-3">
          Workspace is the canonical NodeBench shell.
        </div>
        <div className="flex gap-2">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              className="flex-1 px-3 py-2 text-xs rounded-md border transition-colors bg-primary text-primary-foreground border-primary"
              onClick={() => setLayout("cockpit")}
            >
              <div className="font-medium">{o.label}</div>
              <div className="mt-0.5 opacity-70">{o.desc}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// SMS Usage Stats Component
function SmsUsageStats() {
  const api = useConvexApi();

  // anonymous fallback: when api is undefined (Convex API not yet loaded),
  // useQuery should skip rather than receive a fake args object that
  // could silently degrade to seed data in an authenticated path.
  const smsUsage = useQuery(api?.domains.integrations.sms.getSmsUsageStats ?? "skip", { days: 30 });
  const costBreakdown = useQuery(api?.domains.integrations.sms.getSmsCostBreakdown);

  if (!smsUsage && !costBreakdown) {
    return null;
  }

  return (
    <div className="pt-3 mt-3 border-t border-edge space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-content-secondary">Usage & Cost (Last 30 Days)</span>
        <BarChart2 className="h-3.5 w-3.5 text-content-muted" />
      </div>

      {smsUsage?.totals && (
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-surface-secondary rounded p-2 text-center">
            <div className="text-lg font-bold text-content">{smsUsage.totals.totalMessages}</div>
            <div className="text-xs text-content-secondary">Messages</div>
          </div>
          <div className="bg-surface-secondary rounded p-2 text-center">
            <div className="text-lg font-bold text-content">{smsUsage.totals.totalSegments}</div>
            <div className="text-xs text-content-secondary">Segments</div>
          </div>
          <div className="bg-green-50 dark:bg-green-900/20 rounded p-2 text-center">
            <div className="text-lg font-bold text-green-700 dark:text-green-400">${smsUsage.totals.estimatedCostDollars}</div>
            <div className="text-xs text-content-secondary">Est. Cost</div>
          </div>
        </div>
      )}

      {smsUsage?.totals && smsUsage.totals.totalMessages > 0 && (
        <div className="text-xs text-content-secondary space-y-1">
          <div className="flex justify-between">
            <span>Success rate:</span>
            <span className="font-medium text-green-600 dark:text-green-400">{smsUsage.totals.successRate}</span>
          </div>
          {smsUsage.totals.meetingReminderCount > 0 && (
            <div className="flex justify-between">
              <span>Meeting reminders:</span>
              <span>{smsUsage.totals.meetingReminderCount}</span>
            </div>
          )}
          {smsUsage.totals.morningDigestCount > 0 && (
            <div className="flex justify-between">
              <span>Morning digests:</span>
              <span>{smsUsage.totals.morningDigestCount}</span>
            </div>
          )}
        </div>
      )}

      {costBreakdown && (
        <details className="text-xs text-content-secondary">
          <summary className="cursor-pointer hover:text-content">Pricing details</summary>
          <div className="mt-2 pl-2 space-y-1 border-l-2 border-edge">
            <div className="flex justify-between">
              <span>Per segment:</span>
              <span>~{costBreakdown.perMessage.totalPerSegment.toFixed(2)}¢</span>
            </div>
            <div className="flex justify-between">
              <span>Monthly campaign fee:</span>
              <span>${costBreakdown.monthly.campaignFeeMin}-${costBreakdown.monthly.campaignFeeMax}</span>
            </div>
          </div>
        </details>
      )}
    </div>
  );
}

type SettingsTab =
  | "profile"
  | "usage"
  | "connections";

// Backward-compat: map old tab IDs to new ones
const TAB_COMPAT: Record<string, SettingsTab> = {
  account: "profile",
  integrations: "connections",
  webmcp: "connections",
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: SettingsTab;
};

/** Inline layout mode picker rendered inside the Profile tab. */
function LayoutModePicker() {
  const { setLayout } = useThemeSafe();
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-content">Layout Mode</h3>
      <div className="rounded-lg border border-edge bg-surface p-4 space-y-3">
        <p className="text-xs text-content-secondary">
          Workspace is the canonical NodeBench shell. Legacy page-first layouts are being retired behind compatibility redirects.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setLayout("cockpit")}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md border text-sm font-medium transition-colors border-primary bg-primary/10 text-primary"
          >
            <Layout className="w-4 h-4" />
            Cockpit HUD
          </button>
        </div>
      </div>
    </div>
  );
}

const PROVIDERS: string[] = [
  "openai",
  "gemini",
  // Development integrations
  "github_access_token",
  "github_webhook_secret",
];

export function SettingsModal({ isOpen, onClose, initialTab }: Props) {
  const api = useConvexApi();
  const [active, setActive] = useState<SettingsTab>(TAB_COMPAT[initialTab as string] ?? initialTab ?? "usage");

  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, "save" | "delete" | null>>({});
  const [billingBusy, setBillingBusy] = useState(false);

  // Auth actions for sign out
  const { signOut } = useAuthActions();

  // Keep the active tab in sync with caller preference when opening
  useEffect(() => {
    if (isOpen) {
      setActive(TAB_COMPAT[initialTab as string] ?? initialTab ?? "usage");
    }
  }, [isOpen, initialTab]);

  // Accessibility + dogfood: allow keyboard escape to close the modal reliably.
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  const keyStatuses = useQuery(api?.domains.auth.apiKeys.listApiKeyStatuses ?? "skip", {
    providers: PROVIDERS,
  });

  // Auth state to gate saving/deleting keys and show hints
  const user = useQuery(api?.domains.auth.auth.loggedInUser);

  // Usage (daily + 14-day series) per provider
  const dailyOpenAI = useQuery(api?.domains.auth.usage.getDailyUsagePublic ?? "skip", { provider: "openai" });
  const dailyGemini = useQuery(api?.domains.auth.usage.getDailyUsagePublic ?? "skip", { provider: "gemini" });
  const seriesOpenAI = useQuery(api?.domains.auth.usage.getUsageSeries ?? "skip", { provider: "openai", days: 14 });
  const seriesGemini = useQuery(api?.domains.auth.usage.getUsageSeries ?? "skip", { provider: "gemini", days: 14 });

  // Billing
  const subscription = useQuery(api?.domains.billing.billing.getSubscription);

  const saveEncryptedApiKey = useMutation(api?.domains.auth.apiKeys.saveEncryptedApiKeyPublic);
  const deleteApiKey = useMutation(api?.domains.auth.apiKeys.deleteApiKey);
  const createPolarCheckout = useAction(api.domains.billing.billing.createPolarCheckout);
  const runGmailIngest = useAction(api.domains.integrations.gmail.ingestMessages);
  const runGcalSync = useAction(api.domains.integrations.gcal.syncPrimaryCalendar);

  // Gmail connection status and OAuth
  const gmailConnection = useQuery(api?.domains.integrations.gmail.getConnection ?? "skip", {});
  const getGmailOAuthUrl = useAction(api.domains.integrations.gmail.getOAuthUrl);
  const [connectingGmail, setConnectingGmail] = useState(false);

  // Calendar UI prefs (timezone)
  const calendarPrefs = useQuery(api?.domains.auth.userPreferences.getCalendarUiPrefs ?? "skip", {});
  const _saveTimeZone = useMutation(api?.domains.auth.userPreferences.setTimeZonePreference);
  const browserTz = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone as string | undefined;
    } catch {
      return undefined;
    }
  }, []);
  const [_tzSearch, _setTzSearch] = useState("");
  const tzList: string[] = useMemo(() => {
    try {
      const anyIntl: any = Intl as any;
      if (typeof anyIntl.supportedValuesOf === "function") {
        const vals = anyIntl.supportedValuesOf("timeZone");
        if (Array.isArray(vals) && vals.length > 0) return vals as string[];
      }
    } catch (error) {
      // Fallback for browsers that don't support Intl.supportedValuesOf
    }
    return [
      "UTC",
      "America/Los_Angeles",
      "America/Denver",
      "America/Chicago",
      "America/New_York",
      "Europe/London",
      "Europe/Paris",
      "Europe/Berlin",
      "Asia/Tokyo",
      "Asia/Shanghai",
      "Asia/Kolkata",
      "Australia/Sydney",
    ];
  }, []);
  const _groupedTimeZones = useMemo(() => {
    const q = _tzSearch.trim().toLowerCase();
    const groups: Record<string, string[]> = {};
    for (const tz of tzList) {
      if (q && !tz.toLowerCase().includes(q)) continue;
      const region = tz.includes("/") ? tz.split("/")[0] : "Other";
      if (!groups[region]) groups[region] = [];
      groups[region].push(tz);
    }
    for (const k of Object.keys(groups)) groups[k].sort();
    return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
  }, [tzList, _tzSearch]);
  const [selectedTz, setSelectedTz] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (selectedTz === undefined && calendarPrefs !== undefined) {
      setSelectedTz(calendarPrefs?.timeZone ?? browserTz ?? "UTC");
    }
  }, [calendarPrefs, browserTz, selectedTz]);

  // User preferences (for reminders)
  const userPreferences = useQuery(api?.domains.auth.userPreferences.getUserPreferences);
  const updateUserPreferences = useMutation(api?.domains.auth.userPreferences.updateUserPreferences);
  const updateUngroupedSectionName = useMutation(api?.domains.auth.userPreferences.updateUngroupedSectionName);
  const updateUngroupedExpandedState = useMutation(api?.domains.auth.userPreferences.updateUngroupedExpandedState);
  const setPlannerViewPrefs = useMutation(api?.domains.auth.userPreferences.setPlannerViewPrefs);
  const setPlannerMode = useMutation(api?.domains.auth.userPreferences.setPlannerMode);
  const upsertCalendarHubSizePct = useMutation(api?.domains.auth.userPreferences.upsertCalendarHubSizePct);

  // SMS notification preferences
  const smsPreferences = useQuery(api?.domains.auth.userPreferences.getSmsPreferences);
  const updateSmsPreferences = useMutation(api?.domains.auth.userPreferences.updateSmsPreferences);
  const [smsPhoneInput, setSmsPhoneInput] = useState("");
  const [savingSmsPrefs, setSavingSmsPrefs] = useState(false);

  // Initialize SMS phone input from preferences
  useEffect(() => {
    if (smsPreferences?.phoneNumber && !smsPhoneInput) {
      setSmsPhoneInput(smsPreferences.phoneNumber);
    }
  }, [smsPreferences?.phoneNumber, smsPhoneInput]);
  // OSS Stats integration
  const githubOwner = useQuery(api?.domains.analytics.ossStats.getGithubOwner ?? "skip", { owner: "get-convex" });
  const npmOrg = useQuery(api?.domains.analytics.ossStats.getNpmOrg ?? "skip", { name: "convex-dev" });
  const syncOssStats = useAction(api.domains.analytics.ossStats.syncDefault);
  const syncOssStatsWithUserToken = useAction(api.domains.analytics.ossStats.syncPreferUserToken);
  const ghEncryptedKey = useQuery(api?.domains.auth.apiKeys.getEncryptedApiKeyPublic ?? "skip", { provider: "github_access_token" });
  const [syncingStats, setSyncingStats] = useState(false);
  const [savingReminder, setSavingReminder] = useState(false);
  const [savingSectionName, setSavingSectionName] = useState(false);
  const [savingPlannerPrefs, setSavingPlannerPrefs] = useState(false);
  const [savingCalendarSize, setSavingCalendarSize] = useState(false);
  const [savingCalendarIngest, setSavingCalendarIngest] = useState(false);
  const [syncingCalendar, setSyncingCalendar] = useState<"gmail" | "gcal" | null>(null);
  const [showGithubConfig, setShowGithubConfig] = useState(false);

  // Account & Security
  const sessions = useQuery(api?.domains.auth.account.listSessions);
  const linkedAccounts = useQuery(api?.domains.auth.account.listLinkedAccounts);
  const signOutOtherSessions = useAction(api.domains.auth.account.signOutOtherSessions);
  const signOutSession = useMutation(api?.domains.auth.account.signOutSession);
  const [signingOutOthers, setSigningOutOthers] = useState(false);
  const [signingOutSessionId, setSigningOutSessionId] = useState<string | null>(null);

  // Lazy-generate a client-only passphrase and keep it in localStorage
  const getPassphrase = (): string => {
    try {
      let p = localStorage.getItem("nodebench:e2e:passphrase");
      if (!p) {
        const bytes = new Uint8Array(32);
        crypto.getRandomValues(bytes);
        let bin = "";
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        p = btoa(bin);
        localStorage.setItem("nodebench:e2e:passphrase", p);
      }
      return p;
    } catch (error) {
      // Fallback (less secure) if localStorage or crypto not available
      return "nodebench-default-passphrase";
    }
  };

  const handleUpgrade = async () => {
    if (user === null) {
      toast.error("Please sign in to upgrade");
      return;
    }
    if (subscription && subscription.status === "active") {
      toast.success("You already have Supporter access");
      return;
    }
    try {
      setBillingBusy(true);
      const origin = window.location.origin;
      // Polar requires {CHECKOUT_ID} token in the success URL
      const successUrl = `${origin}/?billing=success&checkout_id={CHECKOUT_ID}`;
      const { url } = await createPolarCheckout({ successUrl });
      window.location.href = url;
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to start checkout");
    } finally {
      setBillingBusy(false);
    }
  };

  // Dynamic import to avoid bundling issues during SSR/build tools
  const encryptClient = async (plaintext: string): Promise<string> => {
    const { encryptToString } = await import("../../lib/e2eCrypto");
    const passphrase = getPassphrase();
    return await encryptToString(plaintext, passphrase);
  };
  const decryptClient = async (ciphertext: string): Promise<string> => {
    const { decryptFromString } = await import("../../lib/e2eCrypto");
    const passphrase = getPassphrase();
    return await decryptFromString(ciphertext, passphrase);
  };

  const planLabel = subscription
    ? subscription.status === "active" ? "Supporter" : "Free"
    : "Loading…";

  const providerStatus = useMemo(() => {
    const map: Record<string, { hasKey: boolean; createdAt?: number }> = {};
    (keyStatuses ?? []).forEach((k: any) => (map[k.provider] = { hasKey: k.hasKey, createdAt: k.createdAt }));
    return map;
  }, [keyStatuses]);

  if (!isOpen) return null;

  const navItems: Array<{ id: SettingsTab; label: string }> = [
    { id: "profile", label: "Profile" },
    { id: "usage", label: "Usage & Costs" },
    { id: "connections", label: "Connections" },
  ];

  const handleSaveKey = async (provider: string) => {
    const value = keyInputs[provider]?.trim();
    if (!value) {
      toast.error("Enter an API key first");
      return;
    }
    if (user === null) {
      toast.error("Please sign in to save API keys");
      return;
    }
    try {
      setBusy((p) => ({ ...p, [provider]: "save" }));
      const encrypted = await encryptClient(value);
      await saveEncryptedApiKey({ provider, encryptedApiKey: encrypted });
      toast.success(`${provider} key saved`);
      setKeyInputs((p) => ({ ...p, [provider]: "" }));
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save key");
    } finally {
      setBusy((p) => ({ ...p, [provider]: null }));
    }
  };

  const handleDeleteKey = async (provider: string) => {
    if (user === null) {
      toast.error("Please sign in to remove API keys");
      return;
    }
    try {
      setBusy((p) => ({ ...p, [provider]: "delete" }));
      await deleteApiKey({ provider });
      toast.success(`${provider} key removed`);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to remove key");
    } finally {
      setBusy((p) => ({ ...p, [provider]: null }));
    }
  };

  const UsageCard = ({
    title,
    daily,
    series,
  }: {
    title: string;
    daily: { count: number; limit: number; date: string } | undefined;
    series: Array<{ date: string; count: number; limit: number }> | undefined;
  }) => {
    const pct = Math.min(100, Math.round(((daily?.count ?? 0) / Math.max(1, daily?.limit ?? 1)) * 100));
    return (
      <div className="rounded-lg border border-edge bg-surface p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <BarChart2 className="h-4 w-4" />
            <span>{title}</span>
          </div>
          <span className="text-xs text-content-secondary">{daily ? new Date(daily.date + "T00:00:00Z").toLocaleDateString('en-US', { month: "short", day: "numeric", timeZone: "UTC" }) : <span className="inline-block w-16 h-3 bg-surface-secondary rounded motion-safe:animate-pulse" />}</span>
        </div>
        <div className="w-full h-2 bg-surface-secondary dark:bg-white/[0.08] rounded">
          <div className="h-2 rounded bg-blue-600" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-2 text-xs text-content-secondary">
          {daily ? (
            <>{daily.count} / {daily.limit} requests today</>
          ) : (
            <>Loading usage…</>
          )}
        </div>
        {series && series.length > 0 && (() => {
          const maxCount = Math.max(...series.map(d => d.count ?? 0));
          return maxCount === 0 ? (
            <div className="mt-3 text-xs text-content-secondary text-center py-3">No usage recorded in the last 14 days</div>
          ) : (
            <div className="mt-3">
              <div className="flex items-center justify-between mb-1">
                <div className="text-xs text-content-secondary">Last 14 days</div>
                <div className="text-xs text-content-secondary tabular-nums">100%</div>
              </div>
              <div className="flex items-end gap-1 h-16 relative">
                <div className="absolute inset-x-0 top-0 border-t border-dashed border-edge dark:border-white/10" />
                <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-edge dark:border-white/10" />
                {series.map((d) => {
                  const ratio = (d.count ?? 0) / Math.max(1, d.limit ?? 1);
                  const h = Math.max(4, Math.min(60, Math.round(ratio * 60)));
                  return (
                    <div key={d.date} className="flex-1 min-w-[4px] bg-surface-secondary dark:bg-white/[0.08] rounded" title={`${d.date}: ${d.count}/${d.limit} (${Math.round(ratio * 100)}%)`}>
                      <div className="w-full bg-blue-600 rounded" style={{ height: h }} />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}
      </div>
    );
  };

  const ApiKeyItem = ({ provider, label }: { provider: string; label: string }) => {
    const hasKey = providerStatus[provider]?.hasKey;
    const isShown = showKeys[provider] ?? false;
    const isBusy = Boolean(busy[provider]);
    const linkedAt = providerStatus[provider]?.createdAt;
    const inputEmpty = !(keyInputs[provider]?.trim());
    return (
      <div className="rounded-lg border border-edge bg-surface p-3">
        <div className="flex items-center gap-2 mb-2">
          <Key className="h-4 w-4" />
          <span className="text-sm font-semibold">{label} API Key</span>
          {hasKey && (
            <span className="ml-2 inline-flex items-center gap-1 text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded">
              <CheckCircle className="h-3 w-3" />
              Linked
            </span>
          )}
          {hasKey && linkedAt && (
            <span className="ml-1 text-xs text-content-secondary">on {new Date(linkedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            type={isShown ? "text" : "password"}
            className="flex-1 px-2 py-1 text-sm rounded border border-edge bg-surface-secondary"
            placeholder={`Enter ${label} API key`}
            value={keyInputs[provider] ?? ""}
            onChange={(e) => setKeyInputs((p) => ({ ...p, [provider]: e.target.value }))}
          />
          <button
            className="px-2 py-1 text-xs rounded border border-edge hover:bg-surface-hover disabled:opacity-50"
            onClick={() => setShowKeys((p) => ({ ...p, [provider]: !isShown }))}
            title={isShown ? "Hide" : "Show"}
            disabled={isBusy}
          >
            {isShown ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
          <button
            className="btn-primary-xs"
            onClick={() => { void handleSaveKey(provider); }}
            disabled={isBusy || user === null || inputEmpty}
          >
            {busy[provider] === "save" ? "Saving..." : "Save"}
          </button>
          {hasKey && (
            <button
              className="px-2 py-1 text-xs rounded border border-edge hover:bg-surface-hover text-red-600 disabled:opacity-50"
              onClick={() => { void handleDeleteKey(provider); }}
              title="Remove saved key"
              disabled={isBusy || user === null}
            >
              {busy[provider] === "delete" ? (
                <span>Removing...</span>
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
            </button>
          )}
        </div>
        <div className="mt-2 text-xs text-content-secondary flex items-center gap-1.5">
          <Shield className="h-3.5 w-3.5 shrink-0" />
          Keys are encrypted and stored on this device only.
        </div>
        <div className="mt-1 text-xs text-content-secondary">
          If you reset your browser data, re-enter your key. Never share keys publicly.
        </div>
        {user === null && (
          <div className="mt-2 text-xs text-content-secondary">Sign in to save or remove API keys.</div>
        )}
      </div>
    );
  };

  return (
    <DialogOverlay
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel="Settings Hub"
      backdropClassName="bg-black/50"
      positionClassName="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div className="relative w-[900px] max-w-[95vw] h-[min(92vh,920px)] max-h-[92vh] bg-background border border-border/60 rounded-lg shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-muted/30 border-b border-border/60">
          <div className="flex items-center gap-2 text-sm font-semibold text-content">
            <SettingsIcon className="h-4 w-4" />
            Settings Hub
          </div>
          <button
            onClick={onClose}
            aria-label="Close settings"
            data-testid="close-settings"
            className="p-1 rounded hover:bg-surface-hover text-content-secondary hover:text-content"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex h-[calc(100%-49px)] min-h-0">
          {/* Left Nav */}
          <div className="w-56 border-r border-border/60 bg-muted/10 p-3 overflow-y-auto">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setActive(item.id)}
                className={`w-full text-left px-2 py-2 rounded text-sm mb-1 transition-colors ${active === item.id
                    ? "bg-background text-content shadow-sm"
                    : "text-content-secondary hover:bg-surface-hover"
                  }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {/* Right Content */}
          <div
            className="flex-1 min-w-0 overflow-y-auto px-4 pt-4 pb-10 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150"
            key={active}
          >
            {active === "usage" ? (
              <div className="space-y-4">
                {/* Plan */}
                <div className="rounded-lg border border-edge bg-surface p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold">Current Plan</div>
                      <div className="text-xs text-content-secondary">{planLabel}</div>
                    </div>
                    <button
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 shadow-sm disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2"
                      onClick={() => { void handleUpgrade(); }}
                      disabled={billingBusy || user === null || !subscription || subscription.status === "active"}
                      title={user === null ? "Sign in to upgrade" : undefined}
                    >
                      {subscription?.status === "active" ? (
                        <>Supporter active</>
                      ) : (
                        <>
                          <ArrowUpRight className="h-3.5 w-3.5" />
                          {billingBusy ? "Redirecting…" : "Upgrade to Supporter · $1/month"}
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Usage */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <UsageCard title="OpenAI Daily Usage" daily={dailyOpenAI} series={seriesOpenAI ?? []} />
                  <UsageCard title="Gemini Daily Usage" daily={dailyGemini} series={seriesGemini ?? []} />
                </div>

                {/* API Keys */}
                <div className="space-y-3">
                  <div className="text-sm font-semibold">Provider Keys</div>
                  <ApiKeyItem provider="openai" label="OpenAI" />
                  <ApiKeyItem provider="gemini" label="Gemini" />
                </div>

                {/* API Usage Tracking */}
                <ApiUsageDisplay />

                {/* Billing (merged) */}
                <div className="rounded-lg border border-edge bg-surface p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold">Supporter Plan</div>
                      <div className="text-xs text-content-secondary">
                        Status: {subscription ? subscription.status : "Loading…"}
                      </div>
                    </div>
                    <button
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 shadow-sm disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2"
                      onClick={() => { void handleUpgrade(); }}
                      disabled={billingBusy || user === null || !subscription || subscription.status === "active"}
                      title={user === null ? "Sign in to upgrade" : undefined}
                    >
                      {subscription?.status === "active" ? (
                        <>Supporter active</>
                      ) : (
                        <>
                          <ArrowUpRight className="h-3.5 w-3.5" />
                          {billingBusy ? "Redirecting…" : "Upgrade to Supporter · $1/month"}
                        </>
                      )}
                    </button>
                  </div>
                  <ul className="mt-3 text-xs text-content-secondary list-disc pl-5 space-y-1">
                    <li>Free tier: 5 requests/day total</li>
                    <li>Supporter: 50 requests/day total</li>
                    <li>One-time $1 purchase unlocks Supporter benefits</li>
                  </ul>
                  {user === null && (
                    <div className="mt-2 text-xs">Sign in to upgrade your account.</div>
                  )}
                </div>

                {/*
                 * Autonomous Continuation panels — budget caps + lessons.
                 * Plan: docs/agents/AUTONOMOUS_CONTINUATION_PLAN.md (PR #116).
                 *  - Budget caps (B-PR6/B-PR7): cap daily token + USD spend
                 *    per ownerKey, with auto-enroll on first save.
                 *  - Lessons (A-PR-B.6/A-PR-B.7): inspect, pin, deprecate
                 *    every captured lesson for a chosen thread.
                 * The connector wraps both pure presentational components
                 * with their Convex queries / mutations.
                 */}
                <div className="space-y-2">
                  <div>
                    <div className="text-sm font-semibold">Agent Resilience</div>
                    <div className="text-xs text-content-secondary">
                      Daily caps, failover lessons, and per-thread audit.
                    </div>
                  </div>
                  <AgentResilienceConnector />
                </div>
              </div>
            ) : active === "profile" ? (
              <div className="space-y-6">
                {/* Theme Customization */}
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-content">Theme & Appearance</h3>
                  <div className="rounded-lg border border-edge bg-surface p-4">
                    <ThemeCustomizer />
                  </div>
                </div>

                {/* Layout Mode */}
                <LayoutModePicker />

                {/* Display & Organization */}
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-content">Display & Organization</h3>

                  {/* Ungrouped Section Name */}
                  <div className="rounded-lg border border-edge bg-surface p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm font-semibold">Sidebar Section Name</div>
                      <div className="text-xs text-content-secondary">
                        Current: "{userPreferences?.ungroupedSectionName ?? "Ungrouped Documents"}"
                      </div>
                    </div>
                    <div className="text-xs text-content-secondary mb-3">
                      Customize the name of the ungrouped documents section in the sidebar.
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        className="flex-1 px-2 py-1 text-sm rounded border border-edge bg-surface-secondary"
                        placeholder="Enter section name"
                        defaultValue={userPreferences?.ungroupedSectionName ?? "Ungrouped Documents"}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            const value = (e.target as HTMLInputElement).value.trim();
                            if (value && value !== userPreferences?.ungroupedSectionName) {
                              setSavingSectionName(true);
                              void updateUngroupedSectionName({ sectionName: value })
                                .then(() => toast.success("Section name updated"))
                                .catch((err: any) => toast.error(err?.message ?? "Failed to update section name"))
                                .finally(() => setSavingSectionName(false));
                            }
                          }
                        }}
                      />
                      <button
                        className="btn-primary-xs"
                        onClick={(e) => {
                          const input = e.currentTarget.previousElementSibling as HTMLInputElement;
                          const value = input.value.trim();
                          if (value && value !== userPreferences?.ungroupedSectionName) {
                            setSavingSectionName(true);
                            void updateUngroupedSectionName({ sectionName: value })
                              .then(() => toast.success("Section name updated"))
                              .catch((err: any) => toast.error(err?.message ?? "Failed to update section name"))
                              .finally(() => setSavingSectionName(false));
                          }
                        }}
                        disabled={savingSectionName || user === null}
                      >
                        {savingSectionName ? "Saving..." : "Save"}
                      </button>
                    </div>
                  </div>

                  {/* Ungrouped Section Expanded State */}
                  <div className="rounded-lg border border-edge bg-surface p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-semibold">Expand Ungrouped Section by Default</div>
                        <div className="text-xs text-content-secondary">Whether the ungrouped documents section should be expanded when you first open the app.</div>
                      </div>
                      <Switch
                        aria-label="Expand ungrouped section by default"
                        checked={userPreferences?.isUngroupedExpanded ?? true}
                        onCheckedChange={(checked) => {
                          if (user === null) {
                            toast.error("Please sign in to change preferences");
                            return;
                          }
                          void updateUngroupedExpandedState({ isExpanded: checked })
                            .then(() => toast.success("Section expansion preference updated"))
                            .catch((err: any) => toast.error(err?.message ?? "Failed to update preference"));
                        }}
                        disabled={user === null}
                      />
                    </div>
                  </div>
                </div>

                {/* Calendar & Planner */}
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-content">Calendar & Planner</h3>

                  {/* Calendar Hub Size */}
                  <div className="rounded-lg border border-edge bg-surface p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm font-semibold">Calendar Panel Size</div>
                      <div className="text-xs text-content-secondary">
                        Current: {calendarPrefs?.calendarHubSizePct ?? 45}%
                      </div>
                    </div>
                    <div className="text-xs text-content-secondary mb-3">
                      Adjust the height of the calendar panel in the calendar view (20-80%).
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min="20"
                        max="80"
                        step="5"
                        className="flex-1"
                        defaultValue={calendarPrefs?.calendarHubSizePct ?? 45}
                        onChange={(e) => {
                          const value = parseInt(e.target.value);
                          setSavingCalendarSize(true);
                          void upsertCalendarHubSizePct({ pct: value })
                            .then(() => toast.success(`Calendar size set to ${value}%`))
                            .catch((err: any) => toast.error(err?.message ?? "Failed to update calendar size"))
                            .finally(() => setSavingCalendarSize(false));
                        }}
                        disabled={savingCalendarSize || user === null}
                      />
                      <span className="text-xs text-content-secondary w-8 text-center">
                        {savingCalendarSize ? "..." : `${calendarPrefs?.calendarHubSizePct ?? 45}%`}
                      </span>
                    </div>
                  </div>

                  {/* Planner Mode */}
                  <div className="rounded-lg border border-edge bg-surface p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm font-semibold">Default Planner Mode</div>
                      <div className="text-xs text-content-secondary">
                        Current: {calendarPrefs?.plannerMode === "calendar" ? "Calendar" : calendarPrefs?.plannerMode === "kanban" ? "Kanban" : "List"}
                      </div>
                    </div>
                    <div className="text-xs text-content-secondary mb-3">
                      Choose your preferred view for the planner/calendar section.
                    </div>
                    <div className="flex gap-2">
                      {[
                        { value: "list" as const, label: "List" },
                        { value: "calendar" as const, label: "Calendar" },
                        { value: "kanban" as const, label: "Kanban" }
                      ].map(({ value, label }) => (
                        <button
                          key={value}
                          className={`px-3 py-1 text-xs rounded border ${calendarPrefs?.plannerMode === value
                              ? "bg-blue-600 text-white border-blue-600"
                              : "border-edge hover:bg-surface-hover"
                            }`}
                          onClick={() => {
                            if (user === null) {
                              toast.error("Please sign in to change preferences");
                              return;
                            }
                            void setPlannerMode({ mode: value })
                              .then(() => toast.success(`Planner mode set to ${label}`))
                              .catch((err: any) => toast.error(err?.message ?? "Failed to update planner mode"));
                          }}
                          disabled={user === null}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Planner Density & Agenda Mode */}
                  <div className="rounded-lg border border-edge bg-surface p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm font-semibold">Planner Density & Agenda View</div>
                    </div>
                    <div className="text-xs text-content-secondary mb-3">
                      Configure the density of the planner and how today's agenda is displayed.
                    </div>
                    <div className="space-y-3">
                      {/* Planner Density */}
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Density</span>
                        <div className="flex gap-2">
                          {[
                            { value: "comfortable" as const, label: "Comfortable" },
                            { value: "compact" as const, label: "Compact" }
                          ].map(({ value, label }) => (
                            <button
                              key={value}
                              className={`px-3 py-1 text-xs rounded border ${calendarPrefs?.plannerDensity === value
                                  ? "bg-blue-600 text-white border-blue-600"
                                  : "border-edge hover:bg-surface-hover"
                                }`}
                              onClick={() => {
                                if (user === null) {
                                  toast.error("Please sign in to change preferences");
                                  return;
                                }
                                setSavingPlannerPrefs(true);
                                void setPlannerViewPrefs({ density: value })
                                  .then(() => toast.success(`Density set to ${label}`))
                                  .catch((err: any) => toast.error(err?.message ?? "Failed to update density"))
                                  .finally(() => setSavingPlannerPrefs(false));
                              }}
                              disabled={savingPlannerPrefs || user === null}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Show Week in Agenda */}
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm">Show Week in Today's Agenda</div>
                          <div className="text-xs text-content-secondary">Display upcoming events for the current week in today's agenda.</div>
                        </div>
                        <Switch
                          aria-label="Show week in today's agenda"
                          checked={calendarPrefs?.showWeekInAgenda ?? true}
                          onCheckedChange={(checked) => {
                            if (user === null) {
                              toast.error("Please sign in to change preferences");
                              return;
                            }
                            setSavingPlannerPrefs(true);
                            void setPlannerViewPrefs({ showWeekInAgenda: checked })
                              .then(() => toast.success(`Week display ${checked ? "enabled" : "disabled"}`))
                              .catch((err: any) => toast.error(err?.message ?? "Failed to update preference"))
                              .finally(() => setSavingPlannerPrefs(false));
                          }}
                          disabled={savingPlannerPrefs || user === null}
                        />
                      </div>

                      {/* Agenda Mode */}
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Agenda View</span>
                        <div className="flex gap-2">
                          {[
                            { value: "list" as const, label: "List" },
                            { value: "kanban" as const, label: "Kanban" }
                          ].map(({ value, label }) => (
                            <button
                              key={value}
                              className={`px-3 py-1 text-xs rounded border ${calendarPrefs?.agendaMode === value
                                  ? "bg-blue-600 text-white border-blue-600"
                                  : "border-edge hover:bg-surface-hover"
                                }`}
                              onClick={() => {
                                if (user === null) {
                                  toast.error("Please sign in to change preferences");
                                  return;
                                }
                                setSavingPlannerPrefs(true);
                                void setPlannerViewPrefs({ agendaMode: value })
                                  .then(() => toast.success(`Agenda view set to ${label}`))
                                  .catch((err: any) => toast.error(err?.message ?? "Failed to update agenda mode"))
                                  .finally(() => setSavingPlannerPrefs(false));
                              }}
                              disabled={savingPlannerPrefs || user === null}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {user === null && (
                  <div className="rounded-lg border border-edge bg-surface p-4">
                    <div className="text-xs text-content-secondary">
                      Sign in to save your preferences. Changes will be applied to your account.
                    </div>
                  </div>
                )}

                {/* User Information (merged from Profile tab) */}
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-content">User Information</h3>

                  {/* User Name & Email */}
                  <div className="rounded-lg border border-edge bg-surface p-4">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-12 h-12 bg-blue-600 rounded-full flex items-center justify-center">
                        <User className="h-6 w-6 text-white" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold">{user?.name || "Anonymous User"}</div>
                        <div className="text-xs text-content-secondary">
                          {user?.email ? (
                            <div className="flex items-center gap-1">
                              <Mail className="h-3 w-3" />
                              {user.email}
                            </div>
                          ) : (
                            "No email provided"
                          )}
                        </div>
                      </div>
                    </div>

                    {user?._creationTime && (
                      <div className="flex items-center gap-1 text-xs text-content-secondary">
                        <Calendar className="h-3 w-3" />
                        Member since {new Date(user._creationTime).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                      </div>
                    )}
                  </div>

                  {/* Account Status */}
                  <div className="rounded-lg border border-edge bg-surface p-4">
                    <div className="text-sm font-semibold mb-2">Account Status</div>
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-content-secondary">Authentication</span>
                        <span className="flex items-center gap-1 text-green-600">
                          <CheckCircle className="h-3 w-3" />
                          {user ? "Signed In" : "Not Signed In"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-content-secondary">Plan</span>
                        <span className="flex items-center gap-1">
                          {subscription?.status === "active" ? (
                            <span className="text-green-600 flex items-center gap-1">
                              <CheckCircle className="h-3 w-3" />
                              Supporter
                            </span>
                          ) : (
                            <span className="text-content-secondary">Free</span>
                          )}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-content-secondary">Time Zone</span>
                        <span className="text-xs text-content">
                          {(() => {
                            const tz = selectedTz ?? browserTz ?? "UTC";
                            try {
                              return new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'long' })
                                .formatToParts(new Date())
                                .find(p => p.type === 'timeZoneName')?.value ?? tz;
                            } catch { return tz; }
                          })()}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Account Actions */}
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-content">Account Actions</h3>

                  {/* Current Session - Log Out */}
                  <div className="rounded-lg border border-edge bg-surface p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="text-sm font-semibold">Current Session</div>
                      {sessions && sessions.find((s: any) => s.isCurrent) && (
                        <div className="text-xs text-content-secondary">
                          Active since {new Date(sessions.find((s: any) => s.isCurrent)!._creationTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </div>
                      )}
                    </div>
                    <div className="mb-3 p-2 bg-blue-50 dark:bg-blue-950/30 rounded border border-blue-100 dark:border-blue-800/30">
                      <div className="flex items-center gap-2 text-xs text-blue-900 dark:text-blue-200">
                        <Shield className="h-3.5 w-3.5" />
                        <span className="font-medium">This Device</span>
                      </div>
                      <div className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                        You are currently signed in on this browser
                      </div>
                    </div>
                    <button
                      className="w-full px-3 py-2 rounded border border-edge hover:bg-surface-hover text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                      onClick={() => {
                        void signOut();
                        toast.success("Signed out successfully");
                        onClose();
                      }}
                      disabled={user === null}
                    >
                      <LogOut className="h-4 w-4" />
                      <span>Log Out of This Device</span>
                    </button>
                    <div className="text-xs text-content-secondary mt-2 text-center">
                      To manage all sessions, scroll down to the Security section
                    </div>
                  </div>

                  {/* Data Management */}
                  <div className="rounded-lg border border-edge bg-surface p-4">
                    <div className="text-sm font-semibold mb-3">Data Management</div>
                    <div className="space-y-3">
                      <button
                        className="w-full text-left px-3 py-2 rounded-lg border border-edge/50 bg-surface/60 backdrop-blur-sm hover:bg-surface-hover hover:border-edge text-sm transition-all duration-200 group"
                        onClick={() => {
                          try {
                            // Collect exportable data from localStorage and app state
                            const exportPayload: Record<string, unknown> = {
                              exportedAt: new Date().toISOString(),
                              version: "1.0.0",
                              source: "nodebench-ai",
                            };

                            // Gather localStorage items with nodebench/app prefixes
                            const appKeys = [
                              "nodebench-theme",
                              "nodebench-layout",
                              "nodebench-recent-searches",
                              "nodebench-saved-memos",
                              "nodebench-tracked-entities",
                              "nodebench-session-notes",
                              "cockpit-surface-cache",
                              "agent-conversations",
                              "research-bookmarks",
                            ];
                            const settings: Record<string, unknown> = {};
                            const savedData: Record<string, unknown> = {};

                            for (const key of appKeys) {
                              const raw = localStorage.getItem(key);
                              if (raw) {
                                try {
                                  savedData[key] = JSON.parse(raw);
                                } catch {
                                  savedData[key] = raw;
                                }
                              }
                            }

                            // Also grab any keys that start with common prefixes
                            for (let i = 0; i < localStorage.length; i++) {
                              const key = localStorage.key(i);
                              if (key && (key.startsWith("nb-") || key.startsWith("nodebench-") || key.startsWith("agent-"))) {
                                const raw = localStorage.getItem(key);
                                if (raw && !savedData[key]) {
                                  try {
                                    savedData[key] = JSON.parse(raw);
                                  } catch {
                                    savedData[key] = raw;
                                  }
                                }
                              }
                            }

                            exportPayload.settings = settings;
                            exportPayload.savedData = savedData;

                            // If no meaningful data, include demo sample
                            if (Object.keys(savedData).length === 0) {
                              exportPayload.note = "No saved data found. This is a sample export for demo/guest mode.";
                              exportPayload.sampleData = {
                                conversations: [
                                  { id: "demo-1", title: "Research briefing", timestamp: new Date().toISOString() },
                                ],
                                memos: [
                                  { id: "memo-1", title: "Product direction memo", status: "draft" },
                                ],
                                trackedEntities: [
                                  { name: "Anthropic", type: "company", addedAt: new Date().toISOString() },
                                  { name: "OpenAI", type: "company", addedAt: new Date().toISOString() },
                                ],
                              };
                            }

                            // Trigger download
                            const blob = new Blob([JSON.stringify(exportPayload, null, 2)], {
                              type: "application/json",
                            });
                            const url = URL.createObjectURL(blob);
                            const date = new Date().toISOString().slice(0, 10);
                            const a = document.createElement("a");
                            a.href = url;
                            a.download = `nodebench-export-${date}.json`;
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                            URL.revokeObjectURL(url);

                            toast.success("Data exported successfully");
                          } catch (err) {
                            toast.error("Export failed. Please try again.");
                          }
                        }}
                      >
                        <div className="flex items-center gap-2">
                          <Download className="h-4 w-4 text-primary group-hover:scale-110 transition-transform" />
                          <span className="font-medium">Export My Data</span>
                        </div>
                        <div className="text-xs text-content-secondary mt-1">
                          Download a JSON copy of your conversations, memos, and settings
                        </div>
                      </button>

                      <button
                        className="w-full text-left px-3 py-2 rounded border border-red-500/20 hover:bg-red-500/10 text-sm transition-colors"
                        onClick={() => {
                          toast.error("Account deletion must be requested through customer support");
                        }}
                      >
                        <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
                          <Trash2 className="h-4 w-4" />
                          Delete Account
                        </div>
                        <div className="text-xs text-content-secondary mt-1">
                          Permanently delete your account and all data
                        </div>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Security & Sessions (merged from Account tab) */}
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-content">Security</h3>

                  {/* Active Sessions */}
                  <div className="rounded-lg border border-edge bg-surface p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <div className="text-sm font-semibold flex items-center gap-2">
                          <Shield className="h-4 w-4" />
                          Active Sessions
                        </div>
                        <div className="text-xs text-content-secondary mt-1">
                          Manage devices where you're signed in
                        </div>
                      </div>
                      <button
                        className="inline-flex items-center gap-1 px-2 py-1 rounded border border-edge hover:bg-surface-hover text-xs disabled:opacity-50"
                        onClick={() => {
                          if (user === null) { toast.error("Please sign in"); return; }
                          setSigningOutOthers(true);
                          void signOutOtherSessions({})
                            .then(() => toast.success("Other sessions signed out"))
                            .catch((e: any) => toast.error(e?.message ?? "Failed"))
                            .finally(() => setSigningOutOthers(false));
                        }}
                        disabled={user === null || signingOutOthers || !((sessions ?? []).some((s: any) => !s.isCurrent))}
                      >
                        {signingOutOthers ? "Signing out…" : "Sign out other devices"}
                      </button>
                    </div>
                    {sessions === undefined ? (
                      <div className="text-xs text-content-secondary">Loading sessions…</div>
                    ) : (sessions.length === 0 ? (
                      <div className="text-xs text-content-secondary">No sessions found.</div>
                    ) : (
                      <div className="space-y-2">
                        {sessions.slice().sort((a: any, b: any) => b._creationTime - a._creationTime).map((s: any) => {
                          const deviceLabel = s.isCurrent ? "This Device" : `Device ${sessions.filter((sess: any) => !sess.isCurrent).indexOf(s) + 1}`;
                          return (
                            <div key={s._id} className={`flex items-center justify-between p-2 rounded border ${s.isCurrent
                                ? "border-blue-200 dark:border-blue-800/30 bg-blue-50 dark:bg-blue-950/30"
                                : "border-edge bg-surface-secondary"
                              }`}>
                              <div className="text-xs flex-1">
                                <div className="flex items-center gap-2">
                                  <Shield className={`h-3 w-3 ${s.isCurrent ? "text-blue-600 dark:text-blue-400" : "text-content-secondary"}`} />
                                  <span className="font-medium">{deviceLabel}</span>
                                  {s.isCurrent && (
                                    <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400">Active</span>
                                  )}
                                </div>
                                <div className="text-xs text-content-secondary mt-0.5">
                                  Signed in: {new Date(s._creationTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                </div>
                              </div>
                              {!s.isCurrent && (
                                <button
                                  type="button"
                                  aria-label="Sign out this session"
                                  title="Sign out this session"
                                  className="px-2 py-1 text-xs rounded border border-red-200 hover:bg-red-50 text-red-600 disabled:opacity-50"
                                  onClick={() => {
                                    setSigningOutSessionId(s._id);
                                    void signOutSession({ sessionId: s._id })
                                      .then(() => toast.success("Session signed out"))
                                      .catch((e: any) => toast.error(e?.message ?? "Failed"))
                                      .finally(() => setSigningOutSessionId(null));
                                  }}
                                  disabled={user === null || signingOutSessionId === s._id}
                                >
                                  <LogOut className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>

                  {/* Notification Preferences */}
                  <div className="rounded-lg border border-edge bg-surface p-4">
                    <div className="text-sm font-semibold mb-2">Notifications</div>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm">API key reminder banner</div>
                        <div className="text-xs text-content-secondary">Show a banner when no API keys are linked.</div>
                      </div>
                      <Switch
                        aria-label="Show API key reminder banner"
                        checked={!(userPreferences?.linkReminderOptOut ?? false)}
                        onCheckedChange={(checked) => {
                          if (user === null) { toast.error("Please sign in"); return; }
                          setSavingReminder(true);
                          void updateUserPreferences({ linkReminderOptOut: !checked })
                            .then(() => toast.success("Preference updated"))
                            .catch((err: any) => toast.error(err?.message ?? "Failed"))
                            .finally(() => setSavingReminder(false));
                        }}
                        disabled={savingReminder}
                      />
                    </div>
                  </div>

                  {/* Linked Accounts */}
                  <div className="rounded-lg border border-edge bg-surface p-4">
                    <div className="text-sm font-semibold mb-2 flex items-center gap-2">
                      <Link className="h-4 w-4" />
                      Linked Accounts
                    </div>
                    {linkedAccounts === undefined ? (
                      <div className="text-xs text-content-secondary">Loading…</div>
                    ) : (linkedAccounts.length === 0 ? (
                      <div className="text-xs text-content-secondary">No linked accounts.</div>
                    ) : (
                      <div className="space-y-2">
                        {linkedAccounts.map((a: any) => (
                          <div key={a._id} className="flex items-center justify-between p-2 rounded border border-edge bg-surface-secondary">
                            <div className="text-xs">
                              <div className="font-medium">{a.provider}</div>
                              <div className="text-xs text-content-secondary">ID: {a.providerAccountId}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>

                {user === null && (
                  <div className="rounded-lg border border-edge bg-surface p-4">
                    <div className="text-xs text-content-secondary">
                      Sign in to view and manage your profile information.
                    </div>
                  </div>
                )}
              </div>
            ) : active === "connections" ? (
              <div className="space-y-6">
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-100">
                  <div className="flex items-start gap-3">
                    <Link className="mt-0.5 h-4 w-4 flex-shrink-0" />
                    <div className="space-y-2">
                      <div className="font-semibold">Start with public research, then link for memory.</div>
                      <p className="text-xs leading-relaxed text-blue-900/80 dark:text-blue-100/80">
                        A first company, person, or role dossier can run without sign-in. Link NodeBench when you want saved research history,
                        higher limits, shared team usage, API keys, webhooks, and billing controls.
                      </p>
                      <div className="flex flex-wrap gap-2 text-[11px] font-medium">
                        <span className="rounded-full bg-white/80 px-2 py-1 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100">
                          first dossier: anonymous
                        </span>
                        <span className="rounded-full bg-white/80 px-2 py-1 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100">
                          memory and limits: linked
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* AI Services */}
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-content">AI Services</h3>

                  <div className="rounded-lg border border-edge bg-surface p-4">
                    <div className="text-sm font-semibold mb-3">Connected AI Providers</div>
                    <div className="space-y-3">
                      {/* OpenAI Integration */}
                      <div className="flex items-center justify-between p-3 rounded border border-edge bg-surface-secondary">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center">
                            <Zap className="h-4 w-4 text-white" />
                          </div>
                          <div>
                            <div className="text-sm font-semibold">OpenAI</div>
                            <div className="text-xs text-content-secondary">
                              GPT-5, GPT-5 Mini, Embeddings
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded ${providerStatus["openai"]?.hasKey
                              ? "bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400"
                              : "bg-surface-secondary text-content-secondary"
                            }`}>
                            <CheckCircle className="h-3 w-3" />
                            {providerStatus["openai"]?.hasKey ? "Connected" : "Not Connected"}
                          </span>
                          <button
                            className="px-2 py-1 text-xs rounded border border-edge hover:bg-surface-hover"
                            onClick={() => setActive("usage")}
                          >
                            Configure
                          </button>
                        </div>
                      </div>

                      {/* Gemini Integration */}
                      <div className="flex items-center justify-between p-3 rounded border border-edge bg-surface-secondary">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center">
                            <Zap className="h-4 w-4 text-white" />
                          </div>
                          <div>
                            <div className="text-sm font-semibold">Google Gemini</div>
                            <div className="text-xs text-content-secondary">
                              Gemini 1.5, Gemini 2.0, Vision
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded ${providerStatus["gemini"]?.hasKey
                              ? "bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400"
                              : "bg-surface-secondary text-content-secondary"
                            }`}>
                            <CheckCircle className="h-3 w-3" />
                            {providerStatus["gemini"]?.hasKey ? "Connected" : "Not Connected"}
                          </span>
                          <button
                            className="px-2 py-1 text-xs rounded border border-edge hover:bg-surface-hover"
                            onClick={() => setActive("usage")}
                          >
                            Configure
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Calendar Ingestion */}
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-content">Calendar Ingestion</h3>
                  <div className="rounded-lg border border-edge bg-surface p-4 space-y-3">
                    {/* Gmail Connection Status */}
                    <div className="flex items-center justify-between p-2 rounded bg-surface-secondary">
                      <div className="flex items-center gap-2">
                        <Mail className="h-4 w-4 text-content-secondary" />
                        <div>
                          <div className="text-sm font-medium">
                            {gmailConnection?.connected ? (
                              <span className="text-green-600">Gmail Connected</span>
                            ) : (
                              <span className="text-amber-600">Gmail Not Connected</span>
                            )}
                          </div>
                          {gmailConnection?.email && (
                            <div className="text-xs text-content-secondary">{gmailConnection.email}</div>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn-primary-sm"
                        disabled={connectingGmail}
                        onClick={async () => {
                          setConnectingGmail(true);
                          try {
                            const result = await getGmailOAuthUrl({});
                            if (result.success && result.url) {
                              // Redirect to Google OAuth
                              window.location.href = result.url;
                            } else {
                              toast.error(result.error ?? "Failed to get OAuth URL");
                            }
                          } catch (err: any) {
                            toast.error(err?.message ?? "Failed to connect Gmail");
                          } finally {
                            setConnectingGmail(false);
                          }
                        }}
                      >
                        {connectingGmail ? "Connecting..." : gmailConnection?.connected ? "Reconnect Gmail" : "Connect Gmail"}
                      </button>
                    </div>

                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-semibold">Auto-sync sources</div>
                        <div className="text-xs text-content-secondary">Gmail (events from email) and Google Calendar</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="inline-flex items-center gap-2 text-xs">
                          <Checkbox
                            checked={userPreferences?.gmailIngestEnabled ?? true}
                            onCheckedChange={async (checked) => {
                              setSavingCalendarIngest(true);
                              try {
                                await updateUserPreferences({ gmailIngestEnabled: checked === true });
                                toast.success("Gmail ingest preference saved");
                              } catch (err: any) {
                                toast.error(err?.message ?? "Failed to save");
                              } finally {
                                setSavingCalendarIngest(false);
                              }
                            }}
                          />
                          Gmail
                        </label>
                        <label className="inline-flex items-center gap-2 text-xs">
                          <Checkbox
                            checked={userPreferences?.gcalSyncEnabled ?? true}
                            onCheckedChange={async (checked) => {
                              setSavingCalendarIngest(true);
                              try {
                                await updateUserPreferences({ gcalSyncEnabled: checked === true });
                                toast.success("GCal sync preference saved");
                              } catch (err: any) {
                                toast.error(err?.message ?? "Failed to save");
                              } finally {
                                setSavingCalendarIngest(false);
                              }
                            }}
                          />
                          Google Calendar
                        </label>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="font-semibold">Auto-add mode</span>
                      {["auto", "propose"].map((mode) => (
                        <button
                          key={mode}
                          className={`px-2 py-1 rounded border text-xs ${(userPreferences?.calendarAutoAddMode ?? "propose") === mode
                              ? "bg-blue-600 text-white border-blue-600"
                              : "border-edge text-content-secondary hover:bg-surface-hover"
                            }`}
                          onClick={async () => {
                            setSavingCalendarIngest(true);
                            try {
                              await updateUserPreferences({ calendarAutoAddMode: mode as "auto" | "propose" });
                              toast.success("Calendar auto-add mode updated");
                            } catch (err: any) {
                              toast.error(err?.message ?? "Failed to save");
                            } finally {
                              setSavingCalendarIngest(false);
                            }
                          }}
                        >
                          {mode === "auto" ? "Auto-add" : "Propose first"}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <button
                        className="px-3 py-2 text-xs rounded border border-edge hover:bg-surface-hover disabled:opacity-50"
                        disabled={syncingCalendar === "gmail"}
                        onClick={async () => {
                          setSyncingCalendar("gmail");
                          try {
                            const res = await runGmailIngest({ maxResults: 15 });
                            if (res?.success) {
                              toast.success(`Gmail ingest: +${res.created} / ${res.updated} updated`);
                            } else {
                              toast.error(res?.error ?? "Gmail ingest failed");
                            }
                          } catch (err: any) {
                            toast.error(err?.message ?? "Gmail ingest failed");
                          } finally {
                            setSyncingCalendar(null);
                          }
                        }}
                      >
                        {syncingCalendar === "gmail" ? "Running…" : "Ingest Gmail now"}
                      </button>
                      <button
                        className="px-3 py-2 text-xs rounded border border-edge hover:bg-surface-hover disabled:opacity-50"
                        disabled={syncingCalendar === "gcal"}
                        onClick={async () => {
                          setSyncingCalendar("gcal");
                          try {
                            const res = await runGcalSync({});
                            if (res?.success) {
                              toast.success(`GCal sync: +${res.created} / ${res.updated} updated`);
                            } else {
                              toast.error(res?.error ?? "GCal sync failed");
                            }
                          } catch (err: any) {
                            toast.error(err?.message ?? "GCal sync failed");
                          } finally {
                            setSyncingCalendar(null);
                          }
                        }}
                      >
                        {syncingCalendar === "gcal" ? "Running…" : "Sync Google Calendar now"}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Communication Platforms */}
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-content">Communication Platforms</h3>

                  <div className="rounded-lg border border-edge bg-surface p-4">
                    <div className="text-sm font-semibold mb-3">Connected Services</div>
                    <div className="space-y-3">
                      {/* Slack Integration */}
                      <div className="flex items-center justify-between p-3 rounded border border-edge bg-surface-secondary">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-purple-500 rounded-full flex items-center justify-center">
                            <Slack className="h-4 w-4 text-white" />
                          </div>
                          <div>
                            <div className="text-sm font-semibold">Slack</div>
                            <div className="text-xs text-content-secondary">
                              Messages, notifications, bot integration
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-surface-secondary text-content-secondary">
                            <Link className="h-3 w-3" />
                            Not connected
                          </span>
                        </div>
                      </div>

                      {/* Discord Integration */}
                      <div className="flex items-center justify-between p-3 rounded border border-edge bg-surface-secondary">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-[var(--accent-primary)] rounded-full flex items-center justify-center">
                            <MessageSquare className="h-4 w-4 text-white" />
                          </div>
                          <div>
                            <div className="text-sm font-semibold">Discord</div>
                            <div className="text-xs text-content-secondary">
                              Channels, messages, webhooks
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-surface-secondary text-content-secondary">
                            <Link className="h-3 w-3" />
                            Not connected
                          </span>
                        </div>
                      </div>

                      {/* Email Integration */}
                      <div className="flex items-center justify-between p-3 rounded border border-edge bg-surface-secondary">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-red-500 rounded-full flex items-center justify-center">
                            <Mail className="h-4 w-4 text-white" />
                          </div>
                          <div>
                            <div className="text-sm font-semibold">Email</div>
                            <div className="text-xs text-content-secondary">
                              Send notifications and automated responses
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400">
                            <CheckCircle className="h-3 w-3" />
                            Configured
                          </span>
                          <button
                            className="px-2 py-1 text-xs rounded border border-edge hover:bg-surface-hover"
                            onClick={() => {
                              toast.info("Email configuration available in AI Chat settings");
                            }}
                          >
                            Configure
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Notifications */}
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-content">Notifications</h3>

                  <div className="rounded-lg border border-edge bg-surface p-4 space-y-4">
                    <div className="flex items-center gap-3 pb-3 border-b border-edge">
                      <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center">
                        <Phone className="h-4 w-4 text-white" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold">ntfy Push</div>
                        <div className="text-xs text-content-secondary">
                          Receive meeting reminders via ntfy topics
                        </div>
                      </div>
                    </div>

                    {/* Phone Number Input */}
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-content-secondary">Notification Topic (ntfy)</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          className="flex-1 px-3 py-2 text-sm border border-edge bg-surface rounded focus:outline-none focus:ring-2 focus:ring-ring"
                          placeholder="my-topic"
                          value={smsPhoneInput}
                          onChange={(e) => setSmsPhoneInput(e.target.value)}
                        />
                        <button
                          type="button"
                          className="btn-primary-sm"
                          disabled={savingSmsPrefs || !smsPhoneInput}
                          onClick={async () => {
                            setSavingSmsPrefs(true);
                            try {
                              await updateSmsPreferences({ phoneNumber: smsPhoneInput });
                              toast.success("Phone number saved");
                            } catch (err: any) {
                              toast.error(err?.message ?? "Failed to save phone number");
                            } finally {
                              setSavingSmsPrefs(false);
                            }
                          }}
                        >
                          {savingSmsPrefs ? "Saving..." : "Save"}
                        </button>
                      </div>
                      <p className="text-xs text-content-secondary">
                        Use your ntfy topic (e.g., my-topic)
                      </p>
                    </div>

                    {/* Master Toggle */}
                    <div className="flex items-center justify-between py-2 border-t border-edge">
                      <div>
                        <div className="text-sm font-medium">Enable Notifications</div>
                        <div className="text-xs text-content-secondary">Master toggle for all notifications</div>
                      </div>
                      <Switch
                        aria-label="Enable notifications"
                        checked={smsPreferences?.smsNotificationsEnabled ?? false}
                        onCheckedChange={async (checked) => {
                          setSavingSmsPrefs(true);
                          try {
                            await updateSmsPreferences({ smsNotificationsEnabled: checked });
                            toast.success(checked ? "Notifications enabled" : "Notifications disabled");
                          } catch (err: any) {
                            toast.error(err?.message ?? "Failed to update");
                          } finally {
                            setSavingSmsPrefs(false);
                          }
                        }}
                      />
                    </div>

                    {/* Notification Types */}
                    <div className="space-y-3 pt-2 border-t border-edge">
                      <div className="text-xs font-medium text-content-secondary">Notification Types</div>

                      <label className="flex items-center justify-between">
                        <div>
                          <div className="text-sm">Meeting Created</div>
                          <div className="text-xs text-content-secondary">When a new meeting is added from Gmail</div>
                        </div>
                        <Checkbox
                          checked={smsPreferences?.smsMeetingCreated ?? false}
                          disabled={!smsPreferences?.smsNotificationsEnabled}
                          onCheckedChange={async (checked) => {
                            try {
                              await updateSmsPreferences({ smsMeetingCreated: checked === true });
                              toast.success("Preference saved");
                            } catch (err: any) {
                              toast.error(err?.message ?? "Failed to update");
                            }
                          }}
                        />
                      </label>

                      <label className="flex items-center justify-between">
                        <div>
                          <div className="text-sm">Meeting Reminder</div>
                          <div className="text-xs text-content-secondary">Before meeting starts</div>
                        </div>
                        <Checkbox
                          checked={smsPreferences?.smsMeetingReminder ?? false}
                          disabled={!smsPreferences?.smsNotificationsEnabled}
                          onCheckedChange={async (checked) => {
                            try {
                              await updateSmsPreferences({ smsMeetingReminder: checked === true });
                              toast.success("Preference saved");
                            } catch (err: any) {
                              toast.error(err?.message ?? "Failed to update");
                            }
                          }}
                        />
                      </label>

                      <label className="flex items-center justify-between">
                        <div>
                          <div className="text-sm">Morning Digest</div>
                          <div className="text-xs text-content-secondary">Daily summary of today's meetings</div>
                        </div>
                        <Checkbox
                          checked={smsPreferences?.smsMorningDigest ?? false}
                          disabled={!smsPreferences?.smsNotificationsEnabled}
                          onCheckedChange={async (checked) => {
                            try {
                              await updateSmsPreferences({ smsMorningDigest: checked === true });
                              toast.success("Preference saved");
                            } catch (err: any) {
                              toast.error(err?.message ?? "Failed to update");
                            }
                          }}
                        />
                      </label>
                    </div>

                    {/* Reminder Time */}
                    <div className="space-y-2 pt-2 border-t border-edge">
                      <label className="text-xs font-medium text-content-secondary">Reminder Time (minutes before meeting)</label>
                      <select
                        className="w-full px-3 py-2 text-sm border border-edge bg-surface rounded focus:outline-none focus:ring-2 focus:ring-ring"
                        value={smsPreferences?.smsReminderMinutes ?? 15}
                        disabled={!smsPreferences?.smsNotificationsEnabled}
                        onChange={async (e) => {
                          try {
                            await updateSmsPreferences({ smsReminderMinutes: parseInt(e.target.value, 10) });
                            toast.success("Reminder time saved");
                          } catch (err: any) {
                            toast.error(err?.message ?? "Failed to update");
                          }
                        }}
                      >
                        <option value={5}>5 minutes</option>
                        <option value={10}>10 minutes</option>
                        <option value={15}>15 minutes</option>
                        <option value={30}>30 minutes</option>
                        <option value={60}>1 hour</option>
                      </select>
                    </div>

                    {/* Status */}
                    <div className="pt-2 border-t border-edge">
                      <div className="flex items-center gap-2 text-xs">
                        {smsPreferences?.phoneNumber && smsPreferences?.smsNotificationsEnabled ? (
                          <>
                            <CheckCircle className="h-4 w-4 text-green-500" />
                            <span className="text-green-700">Notifications active for topic {smsPreferences.phoneNumber}</span>
                          </>
                        ) : (
                          <>
                            <Phone className="h-4 w-4 text-content-muted" />
                            <span className="text-content-secondary">
                              {!smsPreferences?.phoneNumber
                                ? "Add a topic to enable notifications"
                                : "Enable notifications above"}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* SMS Usage Stats */}
                    <SmsUsageStats />
                    <NotificationActivityPanel
                      mode="user"
                      variant="settings"
                      title="Notification Activity"
                      subtitle="Personal delivery log"
                      limit={6}
                    />
                  </div>
                </div>

                {/* Development & Productivity */}
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-content">Development & Productivity</h3>

                  <div className="rounded-lg border border-edge bg-surface p-4">
                    <div className="text-sm font-semibold mb-3">Connected Tools</div>
                    <div className="space-y-3">
                      {/* GitHub OSS Stats Integration */}
                      <div className="p-3 rounded border border-edge bg-surface-secondary">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-gray-800 rounded-full flex items-center justify-center">
                              <Github className="h-4 w-4 text-white" />
                            </div>
                            <div>
                              <div className="text-sm font-semibold">GitHub OSS Stats</div>
                              <div className="text-xs text-content-secondary">
                                {githubOwner ? (
                                  <>
                                    ⭐ {githubOwner.starCount?.toLocaleString() || 0} stars •
                                    📦 {githubOwner.dependentCount?.toLocaleString() || 0} dependents
                                  </>
                                ) : (
                                  "Real-time GitHub statistics"
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded ${githubOwner ? "bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400" : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400"
                              }`}>
                              <CheckCircle className="h-3 w-3" />
                              {githubOwner ? "Active" : "Connecting…"}
                            </span>
                            <button
                              className="px-2 py-1 text-xs rounded border border-edge hover:bg-surface-hover disabled:opacity-50"
                              onClick={() => {
                                if (user === null) {
                                  toast.error("Please sign in to sync stats");
                                  return;
                                }
                                setSyncingStats(true);
                                const run = async () => {
                                  try {
                                    const enc = ghEncryptedKey?.encryptedApiKey;
                                    if (enc) {
                                      const token = await decryptClient(enc);
                                      await syncOssStatsWithUserToken({ token });
                                    } else {
                                      await syncOssStats();
                                    }
                                    toast.success("OSS stats synced successfully");
                                  } catch (error: any) {
                                    toast.error(error?.message ?? "Failed to sync stats");
                                  } finally {
                                    setSyncingStats(false);
                                  }
                                };
                                void run();
                              }}
                              disabled={syncingStats || user === null}
                            >
                              {syncingStats ? "Syncing..." : "Sync"}
                            </button>
                            <button
                              className="px-2 py-1 text-xs rounded border border-edge hover:bg-surface-hover"
                              onClick={() => setShowGithubConfig((v) => !v)}
                              disabled={user === null}
                              title={user === null ? "Sign in to configure" : undefined}
                            >
                              {showGithubConfig ? "Hide" : "Configure"}
                            </button>
                          </div>
                        </div>
                        {showGithubConfig && (
                          <div className="mt-3 space-y-3">
                            <div className="text-xs text-content-secondary">
                              Provide credentials for higher rate limits or private repos. Values are encrypted on this device and saved to your account.
                            </div>
                            <ApiKeyItem provider="github_access_token" label="GitHub Access Token" />
                            <ApiKeyItem provider="github_webhook_secret" label="GitHub Webhook Secret" />
                          </div>
                        )}
                      </div>

                      {/* NPM OSS Stats Integration */}
                      <div className="flex items-center justify-between p-3 rounded border border-edge bg-surface-secondary">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-red-500 rounded-full flex items-center justify-center">
                            <Zap className="h-4 w-4 text-white" />
                          </div>
                          <div>
                            <div className="text-sm font-semibold">NPM Download Stats</div>
                            <div className="text-xs text-content-secondary">
                              {npmOrg ? (
                                <>
                                  📥 {(npmOrg.downloadCount || 0).toLocaleString()} downloads
                                </>
                              ) : (
                                "Package download statistics"
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded ${npmOrg ? "bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400" : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400"
                            }`}>
                            <CheckCircle className="h-3 w-3" />
                            {npmOrg ? "Active" : "Connecting…"}
                          </span>
                          <button
                            className="px-2 py-1 text-xs rounded border border-edge hover:bg-surface-hover"
                            onClick={() => {
                              toast.info("NPM stats sync with GitHub sync");
                            }}
                          >
                            View
                          </button>
                        </div>
                      </div>

                      {/* Webhook Integration */}
                      <div className="flex items-center justify-between p-3 rounded border border-edge bg-surface-secondary">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-orange-500 rounded-full flex items-center justify-center">
                            <Webhook className="h-4 w-4 text-white" />
                          </div>
                          <div>
                            <div className="text-sm font-semibold">Webhooks</div>
                            <div className="text-xs text-content-secondary">
                              Custom integrations and automation
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-surface-secondary text-content-secondary">
                            <Link className="h-3 w-3" />
                            Not connected
                          </span>
                        </div>
                      </div>

                      {/* Tool Server Integration */}
                      <div className="flex items-center justify-between p-3 rounded border border-edge bg-surface-secondary">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-cyan-500 rounded-full flex items-center justify-center">
                            <Zap className="h-4 w-4 text-white" />
                          </div>
                          <div>
                            <div className="text-sm font-semibold">Tool Server</div>
                            <div className="text-xs text-content-secondary">
                              Enables AI tools and integrations
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400">
                            <CheckCircle className="h-3 w-3" />
                            Active
                          </span>
                          <button
                            className="px-2 py-1 text-xs rounded border border-edge hover:bg-surface-hover"
                            onClick={() => {
                              toast.info("Tool configuration available in advanced settings");
                            }}
                          >
                            Configure
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Integration Status Summary */}
                <div className="rounded-lg border border-edge bg-surface p-4">
                  <div className="text-sm font-semibold mb-3">Integration Status</div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                    <div>
                      <div className="text-2xl font-bold text-green-600 dark:text-green-400">2</div>
                      <div className="text-xs text-content-secondary">Active</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">5</div>
                      <div className="text-xs text-content-secondary">Available</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">1</div>
                      <div className="text-xs text-content-secondary">Configured</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-content-secondary">0</div>
                      <div className="text-xs text-content-secondary">Disconnected</div>
                    </div>
                  </div>
                </div>
                {/* WebMCP */}
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-content">Browser Tools</h3>
                  <WebMcpSettingsPanel />
                </div>
              </div>

            ) : (
              <div className="rounded-lg border border-edge bg-surface p-6 text-sm text-content-secondary">
                Select a section from the sidebar.
              </div>
            )}
          </div>
        </div>
      </div>
    </DialogOverlay>
  );
}

export default SettingsModal;
