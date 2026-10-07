/**
 * MobileCaptureFab — 52px terracotta circle, bottom-right, above the
 * MobileTabBar. Mirrors `docs/design/.../ui_kits/nodebench-mobile/Fab.jsx`
 * one-for-one (right 14px, bottom 72px, 52x52, rounded-full, shadow).
 *
 * Tap opens the FastAgentPanel — the "universal composer" entry point for
 * mobile. Aligns with the universal-capture principle in the active plan.
 *
 * Hidden above `md` viewport (desktop has rail + top nav already).
 */
import { Plus } from "lucide-react";
import { useLocation } from "react-router-dom";
import { useFastAgent } from "@/features/agents/context/FastAgentContext";
import "@/features/designKit/exact/exactKit.css";

export function MobileCaptureFab() {
  const { open } = useFastAgent();
  const location = useLocation();
  const surface = new URLSearchParams(location.search).get("surface");
  const hidesPrimaryContent =
    surface === null ||
    surface === "home" ||
    surface === "chat" ||
    surface === "reports" ||
    surface === "packets" ||
    location.pathname.startsWith("/reports/");
  if (hidesPrimaryContent) return null;

  return (
    <button
      type="button"
      onClick={() => open({})}
      aria-label="Capture or ask"
      data-testid="mobile-capture-fab"
      className="m-fab fixed right-[14px] z-40 flex items-center justify-center transition-transform duration-150 ease-out active:scale-[0.96] md:hidden"
      style={{
        // `calc(env(safe-area-inset-bottom) + 72px)` keeps the FAB clear of
        // the MobileTabBar + mobile Safari's home indicator. The 72px baseline
        // matches the design-kit spec.
        bottom: "calc(env(safe-area-inset-bottom, 0px) + 72px)",
        background: "var(--accent-primary, #D97757)",
        boxShadow:
          "0 10px 28px rgba(217,119,87,0.34), 0 2px 8px rgba(15,23,42,0.12)",
      }}
    >
      <Plus size={22} strokeWidth={2.4} aria-hidden />
    </button>
  );
}

export default MobileCaptureFab;
