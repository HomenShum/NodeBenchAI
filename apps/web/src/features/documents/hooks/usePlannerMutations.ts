/**
 * usePlannerMutations
 *
 * Task/event mutation actions: Convex mutation wrappers for planner operations.
 */

import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlannerMutationSlice {
  /** Create a new task */
  createTask: (args: {
    title: string;
    description?: string;
    dueDate?: number;
    priority?: "low" | "medium" | "high" | "urgent";
  }) => Promise<any>;
  /** Persist planner view preferences */
  setPlannerViewPrefs: (args: any) => Promise<any>;
  /** Persist planner mode */
  setPlannerModeMutation: (args: any) => Promise<any>;
  /** Persist upcoming view preferences */
  setUpcomingViewPrefs: (args: any) => Promise<any>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePlannerMutations(): PlannerMutationSlice {
  const createTask = useMutation(api.domains.tasks.userEvents.createTask);

  const setPlannerViewPrefs = useMutation(
    api.domains.auth.userPreferences.setPlannerViewPrefs,
  );

  const setPlannerModeMutation = useMutation(
    api.domains.auth.userPreferences.setPlannerMode,
  );

  // Cast to any until codegen picks up new function
  const setUpcomingViewPrefs = useMutation(
    (api as any).userPreferences.setUpcomingViewPrefs,
  );

  return {
    createTask,
    setPlannerViewPrefs,
    setPlannerModeMutation,
    setUpcomingViewPrefs,
  };
}
