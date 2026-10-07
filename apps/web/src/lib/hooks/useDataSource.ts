/**
 * useDataSource — Smart detection of what's backing the app.
 *
 * Three modes:
 * - "live"  — signed into Convex, real backend data flowing
 * - "local" — not signed in but local MCP server detected on :3100
 * - "demo"  — neither, showing placeholder data
 *
 * Auto-detects on mount and every 30s. No user action required.
 */

import { useState, useEffect, useCallback } from "react";
import { useConvexAuth } from "convex/react";

export type DataSourceMode = "live" | "local" | "demo";

export interface DataSourceStatus {
  mode: DataSourceMode;
  convexAuth: boolean;
  mcpReachable: boolean;
  label: string;
  hint: string;
}

const MCP_HEALTH_URL = "http://localhost:3100/health";
const POLL_INTERVAL = 30_000;

export function useDataSource(): DataSourceStatus {
  const { isAuthenticated } = useConvexAuth();
  const [mcpReachable, setMcpReachable] = useState(false);

  const checkMcp = useCallback(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    fetch(MCP_HEALTH_URL, { signal: controller.signal, mode: "no-cors" })
      .then(() => setMcpReachable(true))
      .catch(() => setMcpReachable(false))
      .finally(() => clearTimeout(timeout));
  }, []);

  useEffect(() => {
    checkMcp();
    const interval = setInterval(checkMcp, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [checkMcp]);

  if (isAuthenticated) {
    return {
      mode: "live",
      convexAuth: true,
      mcpReachable,
      label: "Live",
      hint: "Connected to your account",
    };
  }

  if (mcpReachable) {
    return {
      mode: "local",
      convexAuth: false,
      mcpReachable: true,
      label: "Local",
      hint: "Using local MCP server",
    };
  }

  return {
    mode: "demo",
    convexAuth: false,
    mcpReachable: false,
    label: "Demo",
    hint: "Sign in or start MCP server for live data",
  };
}
