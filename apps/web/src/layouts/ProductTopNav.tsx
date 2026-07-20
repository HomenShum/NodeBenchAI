import { memo } from "react";
import { Command, Moon, Search, Sun } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { type CockpitSurfaceId } from "@/lib/registry/viewRegistry";
import { ExactAvatarMenu } from "@/features/designKit/exact/ExactKit";

const PRODUCT_NAV: Array<{ surfaceId: CockpitSurfaceId; label: string }> = [
  { surfaceId: "ask", label: "Home" },
  { surfaceId: "packets", label: "Reports" },
  { surfaceId: "workspace", label: "Chat" },
  { surfaceId: "history", label: "Inbox" },
  { surfaceId: "connect", label: "Me" },
];

interface ProductTopNavProps {
  activeSurface: CockpitSurfaceId;
  onSurfaceChange: (surface: CockpitSurfaceId) => void;
  onOpenPalette?: () => void;
}

export const ProductTopNav = memo(function ProductTopNav({
  activeSurface,
  onSurfaceChange,
  onOpenPalette,
}: ProductTopNavProps) {
  const { resolvedMode, setMode } = useTheme();

  return (
    <header className="nb-kit-topnav sticky top-0 z-20">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-3">
        <button
          type="button"
          onClick={() => onSurfaceChange("ask")}
          className="inline-flex min-w-0 shrink-0 items-center gap-2.5 text-left"
          aria-label="Open NodeBench home"
        >
          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#d97757] text-[17px] font-bold leading-none text-white">
            N
          </span>
          <span className="truncate text-[15px] font-bold tracking-[-0.01em] text-[#111827] dark:text-white">
            NodeBench <span className="text-[var(--accent-primary)]">AI</span>
          </span>
        </button>

        <nav
          className="ml-2 flex items-center gap-0.5 rounded-[14px] bg-[#f3f4f6] p-1 dark:bg-white/[0.04] dark:ring-1 dark:ring-white/[0.07]"
          aria-label="Primary product navigation"
        >
          {PRODUCT_NAV.map((item) => {
            const isActive = item.surfaceId === activeSurface;
            return (
              <button
                key={item.surfaceId}
                type="button"
                onClick={() => onSurfaceChange(item.surfaceId)}
                data-active={isActive ? "true" : "false"}
                data-state={isActive ? "active" : "inactive"}
                className="nb-kit-topnav-tab"
                aria-current={isActive ? "page" : undefined}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="flex flex-1 justify-center">
          <button
            type="button"
            onClick={onOpenPalette}
            className="nb-kit-topnav-search"
            aria-label="Search reports, entities, inbox"
          >
            <Search size={15} aria-hidden />
            <span className="min-w-0 flex-1 truncate text-left">Search reports, entities, inbox...</span>
            <kbd>
              <Command size={10} aria-hidden />
              K
            </kbd>
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => setMode(resolvedMode === "dark" ? "light" : "dark")}
            className="nb-kit-topnav-icon"
            aria-label={resolvedMode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            title={resolvedMode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {resolvedMode === "dark" ? <Sun size={16} aria-hidden /> : <Moon size={16} aria-hidden />}
          </button>
          <ExactAvatarMenu
            resolvedMode={resolvedMode === "dark" ? "dark" : "light"}
            setMode={(m) => setMode(m)}
            onSurfaceChange={onSurfaceChange}
          />
        </div>
      </div>
    </header>
  );
});

export default ProductTopNav;
