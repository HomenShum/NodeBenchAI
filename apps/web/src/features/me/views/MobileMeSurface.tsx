/**
 * MobileMeSurface — port of
 * docs/design/nodebench-ai-design-system/ui_kits/nodebench-mobile/MobileMe.jsx
 *
 * Mobile-only Me surface. Renders above the desktop MeHome via a `md:hidden`
 * wrapper so the richer desktop preferences panel is untouched.
 *
 * Uses fixture data matching the design kit's `data.jsx` MDATA.me shape.
 * Swap the fixture for live queries once the user profile + workspaces +
 * preferences endpoints are wired to this surface.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Archive,
  ChevronRight,
  FileText,
  Plus,
  Settings,
  Star,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

// ---------------------------------------------------------------------------
// Fixture (mirrors design-kit data.jsx me block)
// ---------------------------------------------------------------------------

interface Workspace {
  id: string;
  name: string;
  initials: string;
  avatarGradient: string;
  role: string;
  members: number;
  active: boolean;
}

interface QuickSetting {
  id: string;
  label: string;
  value: string;
  icon: LucideIcon;
}

const USER = {
  name: "Homen Shum",
  handle: "homen",
  role: "Founder, NodeBench",
  email: "homen@nodebench.ai",
  initials: "HS",
  avatarGradient: "linear-gradient(135deg, rgba(217,119,87,.88), rgba(190,92,60,.72))",
  joined: "Oct 2025",
};

const STATS: { v: string; l: string }[] = [
  { v: "128", l: "Threads" },
  { v: "42", l: "Reports" },
  { v: "9", l: "Workspaces" },
];

const WORKSPACES: Workspace[] = [
  {
    id: "disco",
    name: "Disco Corp.",
    initials: "DC",
    avatarGradient: "linear-gradient(135deg, rgba(17,24,39,.92), rgba(55,65,81,.78))",
    role: "Lead analyst",
    members: 4,
    active: true,
  },
  {
    id: "relay",
    name: "Relay Legal",
    initials: "RL",
    avatarGradient: "linear-gradient(135deg, rgba(30,58,138,.9), rgba(59,130,246,.72))",
    role: "Collaborator",
    members: 7,
    active: false,
  },
  {
    id: "cobalt",
    name: "Cobalt Health",
    initials: "CH",
    avatarGradient: "linear-gradient(135deg, rgba(4,120,87,.9), rgba(16,185,129,.72))",
    role: "Viewer",
    members: 12,
    active: false,
  },
  {
    id: "personal",
    name: "Field notes (personal)",
    initials: "FN",
    avatarGradient: "linear-gradient(135deg, rgba(120,53,15,.92), rgba(180,83,9,.72))",
    role: "Owner",
    members: 1,
    active: false,
  },
];

const QUICK_SETTINGS: QuickSetting[] = [
  { id: "evidence", label: "Evidence style", value: "Cite inline", icon: FileText },
  { id: "voice", label: "Communication", value: "Concise, analyst", icon: Settings },
  { id: "notify", label: "Notifications", value: "Mentions + signals", icon: Settings },
  { id: "appearance", label: "Appearance", value: "Match system", icon: Settings },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function MobileMeSurface() {
  const navigate = useNavigate();
  const [activeWs, setActiveWs] = useState(
    WORKSPACES.find((w) => w.active)?.id ?? WORKSPACES[0].id,
  );

  return (
    <div
      data-testid="mobile-me-surface"
      className="md:hidden min-h-dvh w-full bg-[#f8f7f5] text-[#111827]"
    >
      {/* Header */}
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-black/5 bg-white/85 px-4 pt-4 pb-3 backdrop-blur">
        <div>
          <div className="text-[17px] font-semibold leading-tight">Me</div>
          <div className="text-[11px] text-gray-500">Profile, workspaces, preferences</div>
        </div>
        <button
          className="rounded-full p-2 text-gray-600 hover:bg-black/5 active:scale-95"
          aria-label="Settings"
          onClick={() => navigate("/me/settings")}
        >
          <Settings size={18} strokeWidth={1.7} />
        </button>
      </header>

      <div className="px-4 pt-4 pb-24 space-y-4">
        {/* Identity card */}
        <section className="flex items-center gap-3 rounded-2xl border border-black/5 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div
            className="flex h-14 w-14 flex-none items-center justify-center rounded-2xl font-mono text-[15px] font-bold text-white"
            style={{ background: USER.avatarGradient }}
          >
            {USER.initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="truncate text-[15px] font-semibold text-gray-900">{USER.name}</div>
            <div className="truncate text-[11px] text-gray-500">
              @{USER.handle} · {USER.role}
            </div>
            <div className="truncate font-mono text-[10px] text-gray-400">{USER.email}</div>
          </div>
          <button
            className="flex-none rounded-full border border-black/10 bg-white px-3 py-1.5 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 active:scale-95"
            onClick={() => navigate("/me")}
          >
            Edit
          </button>
        </section>

        {/* Stats strip */}
        <section className="grid grid-cols-3 gap-2">
          {STATS.map((s) => (
            <div
              key={s.l}
              className="rounded-xl border border-black/5 bg-white px-3 py-2.5 text-center"
            >
              <div className="font-mono text-[17px] font-bold text-gray-900">{s.v}</div>
              <div className="text-[10px] uppercase tracking-[0.12em] text-gray-500">{s.l}</div>
            </div>
          ))}
        </section>

        {/* Workspaces */}
        <section>
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-500">
              Workspaces
            </span>
            <button className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold text-[#d97757] hover:bg-[#d97757]/10 active:scale-95">
              <Plus size={13} strokeWidth={2} /> New
            </button>
          </div>
          <div className="overflow-hidden rounded-2xl border border-black/5 bg-white">
            {WORKSPACES.map((w, idx) => {
              const active = activeWs === w.id;
              return (
                <button
                  key={w.id}
                  data-active={active}
                  onClick={() => setActiveWs(w.id)}
                  className={`flex w-full items-center gap-3 px-3 py-3 text-left transition ${
                    idx !== WORKSPACES.length - 1 ? "border-b border-black/5" : ""
                  } ${active ? "bg-[#d97757]/5" : "hover:bg-black/[0.02]"}`}
                >
                  <span
                    className="flex h-9 w-9 flex-none items-center justify-center rounded-xl font-mono text-[11px] font-bold text-white"
                    style={{ background: w.avatarGradient }}
                  >
                    {w.initials}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block truncate text-[13px] font-semibold text-gray-900">
                      {w.name}
                    </span>
                    <span className="block truncate text-[11px] text-gray-500">
                      {w.role} · {w.members} {w.members === 1 ? "member" : "members"}
                    </span>
                  </span>
                  {active ? (
                    <span className="flex-none rounded-full bg-[#d97757] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                      Active
                    </span>
                  ) : (
                    <ChevronRight size={16} className="flex-none text-gray-400" />
                  )}
                </button>
              );
            })}
          </div>
        </section>

        {/* Quick settings */}
        <section>
          <div className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-500">
            Quick settings
          </div>
          <div className="overflow-hidden rounded-2xl border border-black/5 bg-white">
            {QUICK_SETTINGS.map((s, idx) => {
              const Icon = s.icon;
              return (
                <button
                  key={s.id}
                  className={`flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-black/[0.02] ${
                    idx !== QUICK_SETTINGS.length - 1 ? "border-b border-black/5" : ""
                  }`}
                >
                  <span className="flex h-8 w-8 flex-none items-center justify-center text-[#475569]">
                    <Icon size={17} strokeWidth={1.7} />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[12.5px] font-semibold text-gray-900">
                      {s.label}
                    </span>
                    <span className="block truncate text-[11px] text-gray-500">{s.value}</span>
                  </span>
                  <ChevronRight size={15} className="flex-none text-gray-400" />
                </button>
              );
            })}
          </div>
        </section>

        {/* Shortcuts */}
        <section>
          <div className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-500">
            Shortcuts
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              className="flex items-center gap-2 rounded-xl border border-black/5 bg-white px-3 py-2.5 text-[12px] font-semibold text-gray-700 hover:bg-black/[0.02] active:scale-[0.98]"
              onClick={() => navigate("/?surface=home")}
            >
              <Star size={15} className="text-[#d97757]" />
              Starred threads
            </button>
            <button
              className="flex items-center gap-2 rounded-xl border border-black/5 bg-white px-3 py-2.5 text-[12px] font-semibold text-gray-700 hover:bg-black/[0.02] active:scale-[0.98]"
              onClick={() => navigate("/?surface=reports")}
            >
              <FileText size={15} className="text-gray-500" />
              My drafts
            </button>
            <button className="flex items-center gap-2 rounded-xl border border-black/5 bg-white px-3 py-2.5 text-[12px] font-semibold text-gray-700 hover:bg-black/[0.02] active:scale-[0.98]">
              <Archive size={15} className="text-gray-500" />
              Archive
            </button>
            <button className="flex items-center gap-2 rounded-xl border border-black/5 bg-white px-3 py-2.5 text-[12px] font-semibold text-gray-700 hover:bg-black/[0.02] active:scale-[0.98]">
              <FileText size={15} className="text-gray-500" />
              Billing & plan
            </button>
          </div>
        </section>

        {/* Footer */}
        <div className="pt-2 text-center">
          <div className="text-[10px] text-gray-400">
            NodeBench · member since {USER.joined}
          </div>
          <button className="mt-2 inline-flex items-center justify-center rounded-full border border-black/10 bg-white px-4 py-1.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 active:scale-95">
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
