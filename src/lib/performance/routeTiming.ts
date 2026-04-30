import { useEffect, useRef } from "react";

export type NodeBenchViewportClass = "mobile" | "tablet" | "desktop";

export type NodeBenchPerfRecord = {
  id: number;
  routeId: string;
  surfaceId: string;
  viewportClass: NodeBenchViewportClass;
  startedAt: number;
  createdAtIso: string;
  rootSelector: string;
  firstActionSelector?: string;
  rootVisibleMs?: number;
  firstActionVisibleMs?: number;
  completedMs?: number;
  consoleErrorCount: number;
  consoleWarningCount: number;
  pageErrorCount: number;
  convexWarningCount: number;
  dataSource?: string;
};

type IssueCounts = {
  consoleError: number;
  consoleWarning: number;
  pageError: number;
  convexWarning: number;
};

type RecordInput = {
  routeId: string;
  surfaceId: string;
  viewportClass: NodeBenchViewportClass;
  rootSelector: string;
  firstActionSelector?: string;
  dataSource?: string;
};

export type NodeBenchPerfBuffer = {
  records: NodeBenchPerfRecord[];
  issueCounts: IssueCounts;
  startRecord: (input: RecordInput) => number;
  mark: (id: number, patch: Partial<NodeBenchPerfRecord>) => void;
  getLatest: (routeId?: string) => NodeBenchPerfRecord | undefined;
  getRecords: () => NodeBenchPerfRecord[];
  reset: () => void;
};

declare global {
  interface Window {
    __nodebenchPerf?: NodeBenchPerfBuffer;
  }
}

const MAX_RECORDS = 80;
const CONVEX_WARNING_RE = /convex backend not configured|fixture fallback|starter data|fallback data/i;

let consolePatched = false;
let errorListenersInstalled = false;

export function getViewportClass(width = window.innerWidth): NodeBenchViewportClass {
  if (width < 768) return "mobile";
  if (width < 1024) return "tablet";
  return "desktop";
}

export function isNodeBenchPerfEnabled() {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return (
    import.meta.env.DEV ||
    params.has("nbPerf") ||
    params.get("dogfoodPerf") === "1" ||
    window.localStorage.getItem("nodebench.dogfoodPerf") === "1"
  );
}

export function ensureNodeBenchPerfBuffer(): NodeBenchPerfBuffer | null {
  if (typeof window === "undefined" || !isNodeBenchPerfEnabled()) return null;
  if (window.__nodebenchPerf) return window.__nodebenchPerf;

  const buffer: NodeBenchPerfBuffer = {
    records: [],
    issueCounts: {
      consoleError: 0,
      consoleWarning: 0,
      pageError: 0,
      convexWarning: 0,
    },
    startRecord(input) {
      const id = Math.floor(performance.timeOrigin + performance.now() + Math.random() * 1000);
      const record: NodeBenchPerfRecord = {
        id,
        routeId: input.routeId,
        surfaceId: input.surfaceId,
        viewportClass: input.viewportClass,
        startedAt: performance.now(),
        createdAtIso: new Date().toISOString(),
        rootSelector: input.rootSelector,
        firstActionSelector: input.firstActionSelector,
        consoleErrorCount: this.issueCounts.consoleError,
        consoleWarningCount: this.issueCounts.consoleWarning,
        pageErrorCount: this.issueCounts.pageError,
        convexWarningCount: this.issueCounts.convexWarning,
        dataSource: input.dataSource,
      };
      this.records.push(record);
      if (this.records.length > MAX_RECORDS) this.records.splice(0, this.records.length - MAX_RECORDS);
      return id;
    },
    mark(id, patch) {
      const record = this.records.find((item) => item.id === id);
      if (!record) return;
      Object.assign(record, patch);
    },
    getLatest(routeId) {
      const records = routeId
        ? this.records.filter((record) => record.routeId === routeId)
        : this.records;
      return records[records.length - 1];
    },
    getRecords() {
      return [...this.records];
    },
    reset() {
      this.records = [];
      this.issueCounts = {
        consoleError: 0,
        consoleWarning: 0,
        pageError: 0,
        convexWarning: 0,
      };
    },
  };

  window.__nodebenchPerf = buffer;
  installIssueCollectors(buffer);
  return buffer;
}

function installIssueCollectors(buffer: NodeBenchPerfBuffer) {
  if (!consolePatched) {
    consolePatched = true;
    const originalError = console.error.bind(console);
    const originalWarn = console.warn.bind(console);
    console.error = (...args: unknown[]) => {
      buffer.issueCounts.consoleError += 1;
      const text = args.map(String).join(" ");
      if (CONVEX_WARNING_RE.test(text)) buffer.issueCounts.convexWarning += 1;
      originalError(...args);
    };
    console.warn = (...args: unknown[]) => {
      buffer.issueCounts.consoleWarning += 1;
      const text = args.map(String).join(" ");
      if (CONVEX_WARNING_RE.test(text)) buffer.issueCounts.convexWarning += 1;
      originalWarn(...args);
    };
  }

  if (!errorListenersInstalled) {
    errorListenersInstalled = true;
    window.addEventListener("error", () => {
      buffer.issueCounts.pageError += 1;
    });
    window.addEventListener("unhandledrejection", () => {
      buffer.issueCounts.pageError += 1;
    });
  }
}

function isVisible(selector: string) {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
}

export function useRoutePerformanceRecord({
  routeId,
  surfaceId,
  rootSelector,
  firstActionSelector,
  dataSource,
  timeoutMs = 5000,
}: RecordInput & { timeoutMs?: number }) {
  const lastKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const buffer = ensureNodeBenchPerfBuffer();
    if (!buffer) return;

    const key = `${routeId}:${surfaceId}:${rootSelector}:${firstActionSelector ?? ""}:${dataSource ?? ""}`;
    if (lastKeyRef.current === key) return;
    lastKeyRef.current = key;

    const id = buffer.startRecord({
      routeId,
      surfaceId,
      viewportClass: getViewportClass(),
      rootSelector,
      firstActionSelector,
      dataSource,
    });
    const startedAt = performance.now();
    const startCounts = { ...buffer.issueCounts };
    let frame = 0;
    let complete = false;

    const tick = () => {
      const elapsed = performance.now() - startedAt;
      const record = buffer.records.find((item) => item.id === id);
      if (!record) return;

      const patch: Partial<NodeBenchPerfRecord> = {
        consoleErrorCount: buffer.issueCounts.consoleError - startCounts.consoleError,
        consoleWarningCount: buffer.issueCounts.consoleWarning - startCounts.consoleWarning,
        pageErrorCount: buffer.issueCounts.pageError - startCounts.pageError,
        convexWarningCount: buffer.issueCounts.convexWarning - startCounts.convexWarning,
      };

      if (record.rootVisibleMs == null && isVisible(rootSelector)) {
        patch.rootVisibleMs = Math.round(elapsed);
      }
      if (
        firstActionSelector &&
        record.firstActionVisibleMs == null &&
        isVisible(firstActionSelector)
      ) {
        patch.firstActionVisibleMs = Math.round(elapsed);
      }

      const nextRootVisible = patch.rootVisibleMs ?? record.rootVisibleMs;
      const nextActionVisible = firstActionSelector
        ? patch.firstActionVisibleMs ?? record.firstActionVisibleMs
        : true;

      if (nextRootVisible != null && nextActionVisible != null && !complete) {
        complete = true;
        patch.completedMs = Math.round(elapsed);
      }

      buffer.mark(id, patch);

      if (!complete && elapsed < timeoutMs) {
        frame = window.requestAnimationFrame(tick);
      }
    };

    frame = window.requestAnimationFrame(tick);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [routeId, surfaceId, rootSelector, firstActionSelector, dataSource, timeoutMs]);
}
