/**
 * useCockpitMode — Hook that wraps useCockpitRouting with mode awareness.
 *
 * Adds CockpitMode derivation on top of the existing routing system.
 * Navigating to a mode switches to that mode's default view.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useCockpitRouting } from "../hooks/useCockpitRouting";
import { buildCockpitPath, getSurfaceForView } from "@/lib/registry/viewRegistry";
import {
  type CockpitMode,
  VIEW_TO_MODE,
  MODES,
  getModeForView,
} from "./cockpitModes";

export function useCockpitMode() {
  const routing = useCockpitRouting();
  const { setCurrentView } = routing;
  const navigate = useNavigate();
  const location = useLocation();

  const mode = VIEW_TO_MODE[routing.currentView] ?? "mission";
  const modeConfig = useMemo(() => getModeForView(routing.currentView), [routing.currentView]);

  // On first mount, ensure the root route lands on Home unless the URL is explicit.
  const initRef = useRef(false);
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    const isHomeLikePath =
      location.pathname === "/" ||
      location.pathname === "/control-plane" ||
      location.pathname === "/home" ||
      location.pathname === "/landing";
    if (!isHomeLikePath) return;
    // If URL already has an explicit surface OR view param, respect it — don't override.
    // This prevents /?surface=memo from being clobbered.
    const urlParams = new URLSearchParams(location.search);
    if (urlParams.has("surface") || urlParams.has("view")) return;
    const defaultView = "control-plane";
    if (mode !== "mission" || routing.currentView !== defaultView) {
      setCurrentView(defaultView);
      const path = buildCockpitPath({ surfaceId: getSurfaceForView(defaultView) });
      navigate(path, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, location.search]);

  const setMode = useCallback(
    (m: CockpitMode) => {
      const config = MODES.find((c) => c.id === m);
      if (config) {
        setCurrentView(config.defaultView);
        const path = buildCockpitPath({ surfaceId: getSurfaceForView(config.defaultView) });
        navigate(path);
      }
    },
    [setCurrentView, navigate],
  );

  return {
    ...routing,
    mode,
    setMode,
    modeConfig,
  };
}
