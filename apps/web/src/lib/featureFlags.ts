/**
 * Feature Flags — Gradual rollout management for new UI/UX features.
 *
 * Supports:
 * - URL-based opt-in (?layout=object-first)
 * - localStorage persistence for beta testers
 * - per-surface enablement
 * - gradual rollout percentages (future)
 */

import { useState, useEffect, useCallback } from "react";

export type FeatureFlag =
  | "object-first-layout"
  | "object-first-chat"
  | "object-first-reports"
  | "enhanced-artifact-tabs"
  | "unified-composer";

interface FeatureFlagConfig {
  enabled: boolean;
  defaultValue: boolean;
  allowUrlOverride: boolean;
  allowStorageOverride: boolean;
  description: string;
}

const FEATURE_FLAG_CONFIG: Record<FeatureFlag, FeatureFlagConfig> = {
  "object-first-layout": {
    enabled: true,
    defaultValue: true,
    allowUrlOverride: true,
    allowStorageOverride: true,
    description: "New object-first two-column layout with chat lane and artifact host",
  },
  "object-first-chat": {
    enabled: true,
    defaultValue: false,
    allowUrlOverride: true,
    allowStorageOverride: true,
    description: "Object-first layout for Chat/Workspace surface",
  },
  "object-first-reports": {
    enabled: true,
    defaultValue: false,
    allowUrlOverride: true,
    allowStorageOverride: true,
    description: "Object-first layout for Reports/Packet surface",
  },
  "enhanced-artifact-tabs": {
    enabled: true,
    defaultValue: true,
    allowUrlOverride: false,
    allowStorageOverride: false,
    description: "New business-oriented artifact tabs (Brief/Notebook/Sources/Activity/Files)",
  },
  "unified-composer": {
    enabled: true,
    defaultValue: true,
    allowUrlOverride: false,
    allowStorageOverride: false,
    description: "Unified bottom-anchored composer across all surfaces",
  },
};

const STORAGE_KEY = "nodebench-feature-flags";
const URL_PARAM_PREFIX = "ff_";

/**
 * Parse feature flags from URL search params
 */
function parseUrlFlags(): Partial<Record<FeatureFlag, boolean>> {
  const flags: Partial<Record<FeatureFlag, boolean>> = {};
  const params = new URLSearchParams(window.location.search);

  params.forEach((value, key) => {
    if (key.startsWith(URL_PARAM_PREFIX)) {
      const flagName = key.slice(URL_PARAM_PREFIX.length) as FeatureFlag;
      if (flagName in FEATURE_FLAG_CONFIG) {
        flags[flagName] = value === "1" || value === "true";
      }
    }
  });

  // Also support ?layout=object-first as shorthand
  const layout = params.get("layout");
  if (layout === "object-first" || layout === "objectFirst") {
    flags["object-first-layout"] = true;
    flags["object-first-chat"] = true;
    flags["object-first-reports"] = true;
  }

  return flags;
}

/**
 * Load feature flags from localStorage
 */
function loadStoredFlags(): Partial<Record<FeatureFlag, boolean>> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // Ignore parse errors
  }
  return {};
}

/**
 * Save feature flags to localStorage
 */
function saveStoredFlags(flags: Partial<Record<FeatureFlag, boolean>>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(flags));
  } catch {
    // Ignore storage errors
  }
}

/**
 * Compute final feature flag value considering defaults, URL, and storage
 */
export function getFeatureFlag(flag: FeatureFlag): boolean {
  const config = FEATURE_FLAG_CONFIG[flag];
  if (!config.enabled) return false;

  // URL params take highest priority
  if (config.allowUrlOverride) {
    const urlFlags = parseUrlFlags();
    if (flag in urlFlags) {
      return urlFlags[flag]!;
    }
  }

  // Storage takes second priority
  if (config.allowStorageOverride) {
    const storedFlags = loadStoredFlags();
    if (flag in storedFlags) {
      return storedFlags[flag]!;
    }
  }

  // Fall back to default
  return config.defaultValue;
}

/**
 * Hook for reactive feature flag access
 */
export function useFeatureFlag(flag: FeatureFlag): boolean {
  const [value, setValue] = useState(() => getFeatureFlag(flag));

  useEffect(() => {
    // Re-check on mount (for SSR compatibility)
    setValue(getFeatureFlag(flag));

    // Listen for storage changes
    const handleStorage = () => {
      setValue(getFeatureFlag(flag));
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [flag]);

  return value;
}

/**
 * Hook for multiple feature flags
 */
export function useFeatureFlags(
  flags: FeatureFlag[]
): Record<FeatureFlag, boolean> {
  const [values, setValues] = useState<Record<FeatureFlag, boolean>>(() => {
    const initial: Partial<Record<FeatureFlag, boolean>> = {};
    flags.forEach((flag) => {
      initial[flag] = getFeatureFlag(flag);
    });
    return initial as Record<FeatureFlag, boolean>;
  });

  useEffect(() => {
    const update = () => {
      const updated: Partial<Record<FeatureFlag, boolean>> = {};
      flags.forEach((flag) => {
        updated[flag] = getFeatureFlag(flag);
      });
      setValues(updated as Record<FeatureFlag, boolean>);
    };

    window.addEventListener("storage", update);
    return () => window.removeEventListener("storage", update);
  }, [flags]);

  return values;
}

/**
 * Manually set a feature flag (stored in localStorage)
 */
export function setFeatureFlag(flag: FeatureFlag, value: boolean): void {
  const config = FEATURE_FLAG_CONFIG[flag];
  if (!config.allowStorageOverride) {
    console.warn(`Feature flag "${flag}" does not allow storage override`);
    return;
  }

  const stored = loadStoredFlags();
  stored[flag] = value;
  saveStoredFlags(stored);

  // Dispatch event for reactive updates
  window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
}

/**
 * Reset all feature flags to defaults
 */
export function resetFeatureFlags(): void {
  localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
}

/**
 * Get all feature flag status for debugging
 */
export function getAllFeatureFlags(): Array<{
  flag: FeatureFlag;
  value: boolean;
  defaultValue: boolean;
  description: string;
}> {
  return (Object.keys(FEATURE_FLAG_CONFIG) as FeatureFlag[]).map((flag) => ({
    flag,
    value: getFeatureFlag(flag),
    defaultValue: FEATURE_FLAG_CONFIG[flag].defaultValue,
    description: FEATURE_FLAG_CONFIG[flag].description,
  }));
}

/**
 * React hook for setting feature flags
 */
export function useFeatureFlagSetter() {
  return useCallback((flag: FeatureFlag, value: boolean) => {
    setFeatureFlag(flag, value);
  }, []);
}

/**
 * Check if any object-first features are enabled
 */
export function isObjectFirstEnabled(): boolean {
  return (
    getFeatureFlag("object-first-layout") ||
    getFeatureFlag("object-first-chat") ||
    getFeatureFlag("object-first-reports")
  );
}

/**
 * Hook for object-first status
 */
export function useObjectFirstStatus(): {
  enabled: boolean;
  chatEnabled: boolean;
  reportsEnabled: boolean;
} {
  const layout = useFeatureFlag("object-first-layout");
  const chat = useFeatureFlag("object-first-chat");
  const reports = useFeatureFlag("object-first-reports");

  return {
    enabled: layout || chat || reports,
    chatEnabled: layout || chat,
    reportsEnabled: layout || reports,
  };
}
