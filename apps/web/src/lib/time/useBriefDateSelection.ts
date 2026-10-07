import * as React from "react";

const STORAGE_KEY = "nodebench.dailyBrief.selectedDate";
const EVENT_NAME = "nodebench:dailyBrief:selectedDate";

/**
 * Shared selected date for Daily Brief / LiveDashboard history.
 * Uses localStorage + a same-tab custom event to sync across components.
 */
export function useBriefDateSelection() {
  const [selectedDate, setSelectedDateState] = React.useState<string | null>(
    null,
  );

  // Load initial value and subscribe to cross-tab storage changes.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) setSelectedDateState(stored);

    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      setSelectedDateState(e.newValue || null);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Same-tab broadcast listener.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const onEvent = (e: Event) => {
      const ce = e as CustomEvent<string | null>;
      setSelectedDateState(ce.detail || null);
    };
    window.addEventListener(EVENT_NAME, onEvent as EventListener);
    return () =>
      window.removeEventListener(EVENT_NAME, onEvent as EventListener);
  }, []);

  const setSelectedDate = React.useCallback((date: string | null) => {
    setSelectedDateState(date);
    if (typeof window === "undefined") return;
    if (date) {
      window.localStorage.setItem(STORAGE_KEY, date);
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: date }));
  }, []);

  return [selectedDate, setSelectedDate] as const;
}
