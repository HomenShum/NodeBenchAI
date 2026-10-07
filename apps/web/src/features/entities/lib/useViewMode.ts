/**
 * useViewMode - route-backed notebook/report mode.
 *
 * URL is the source of truth:
 *   - /entity/:slug => edit
 *   - /entity/:slug?view=read => read
 *   - /share/:token?... => forced read
 */

import { useCallback, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";

export type ViewMode = "edit" | "read";

const URL_PARAM_KEY = "view";

export function useViewMode(): {
  viewMode: ViewMode;
  setViewMode: (next: ViewMode) => void;
  isReadMode: boolean;
} {
  const location = useLocation();
  const navigate = useNavigate();
  const isShareRoute = location.pathname.startsWith("/share/");

  const viewMode = useMemo<ViewMode>(() => {
    if (isShareRoute) return "read";
    const params = new URLSearchParams(location.search);
    return params.get(URL_PARAM_KEY) === "read" ? "read" : "edit";
  }, [isShareRoute, location.search]);

  const setViewMode = useCallback(
    (next: ViewMode) => {
      if (isShareRoute) return;
      const params = new URLSearchParams(location.search);
      if (next === "read") {
        params.set(URL_PARAM_KEY, "read");
      } else {
        params.delete(URL_PARAM_KEY);
      }
      const nextSearch = params.toString();
      navigate(
        {
          pathname: location.pathname,
          search: nextSearch ? `?${nextSearch}` : "",
          hash: location.hash,
        },
        { replace: false },
      );
    },
    [isShareRoute, location.hash, location.pathname, location.search, navigate],
  );

  return { viewMode, setViewMode, isReadMode: viewMode === "read" };
}
