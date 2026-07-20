/**
 * OracleSessionContext — App-wide Oracle session state
 *
 * Wraps useOracleSession and exposes it via React context so any view
 * can read the active session, update cross-check status, or record
 * tool usage without prop drilling.
 *
 * The OracleSessionBanner reads from this context to render the
 * persistent status bar across all views.
 */

import { createContext, useContext, type ReactNode } from "react";
import { useOracleSession, type UseOracleSessionReturn } from "@/hooks/useOracleSession";

const OracleSessionContext = createContext<UseOracleSessionReturn | null>(null);

export function OracleSessionProvider({ children }: { children: ReactNode }) {
  const oracle = useOracleSession();

  return (
    <OracleSessionContext.Provider value={oracle}>
      {children}
    </OracleSessionContext.Provider>
  );
}

/**
 * Access the Oracle session from any component.
 * Returns null if no OracleSessionProvider is in the tree (safe fallback).
 */
export function useOracleSessionContext(): UseOracleSessionReturn | null {
  return useContext(OracleSessionContext);
}

/**
 * Access the Oracle session, throws if no provider.
 * Use in components that require Oracle integration.
 */
export function useRequiredOracleSession(): UseOracleSessionReturn {
  const ctx = useContext(OracleSessionContext);
  if (!ctx) {
    throw new Error(
      "useRequiredOracleSession must be used within an OracleSessionProvider",
    );
  }
  return ctx;
}
