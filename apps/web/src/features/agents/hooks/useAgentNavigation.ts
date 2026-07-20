/**
 * useAgentNavigation — React hook for agent-driven view switching.
 *
 * Watches for pending navigation intents from the agent and triggers
 * UI view changes. The agent calls requestNavigation mutation,
 * and this hook detects + acknowledges the intent.
 */

import { useQuery, useMutation } from "convex/react";
import { useCallback, useEffect, useRef } from "react";
import { api } from "../../../../convex/_generated/api";

interface UseAgentNavigationOptions {
  threadId: string | null;
  onNavigate: (targetView: string, context?: any) => void;
  enabled?: boolean;
}

export function useAgentNavigation({
  threadId,
  onNavigate,
  enabled = true,
}: UseAgentNavigationOptions) {
  const pendingNav = useQuery(
    api.domains.agents.agentNavigation.getPendingNavigation,
    threadId && enabled ? { threadId } : "skip"
  );

  const acknowledgeNav = useMutation(
    api.domains.agents.agentNavigation.acknowledgeNavigation
  );

  const processedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!pendingNav || !enabled) return;

    // Prevent processing the same intent twice
    if (processedRef.current.has(pendingNav.navigationId)) return;
    processedRef.current.add(pendingNav.navigationId);

    // Trigger the navigation callback
    onNavigate(pendingNav.targetView, pendingNav.context);

    // Acknowledge so it won't fire again
    void acknowledgeNav({ navigationId: pendingNav.navigationId });
  }, [pendingNav, enabled, onNavigate, acknowledgeNav]);

  const requestNavigation = useMutation(
    api.domains.agents.agentNavigation.requestNavigation
  );

  const navigate = useCallback(
    async (targetView: string, context?: any, reason?: string) => {
      if (!threadId) return;
      await requestNavigation({
        threadId,
        targetView,
        context,
        reason,
      });
    },
    [threadId, requestNavigation]
  );

  return { navigate, pendingNavigation: pendingNav };
}
