/**
 * Resolves a federated-search FederatedHandle to concrete UI actions.
 *
 * Each handle has a stable `uri` like `entity://acme-ai`, `report://abc123`,
 * etc. This module owns the mapping `uri -> route`.
 *
 * Two action surfaces:
 *   - primary  (Enter)        — open the result in its native context
 *   - secondary (Cmd+Enter)   — "ask about this" — pre-fill the chat composer
 *
 * Both return paths or query strings; the caller invokes navigate().
 *
 * Pattern: pure function, no React, no router. Easy to unit test.
 */

import type { FederatedHandle } from "./types";

export interface ResolvedActions {
  primaryPath: string;
  secondaryPath: string;
}

/**
 * Extract the slug or id from a uri like `entity://slug` or `report://abc123`.
 * Returns the empty string if the URI is malformed.
 */
function uriBody(uri: string, scheme: string): string {
  const prefix = `${scheme}://`;
  if (!uri.startsWith(prefix)) return "";
  return uri.slice(prefix.length);
}

/**
 * Build a chat URL pre-filled with a question about this handle.
 * Used for Cmd+Enter "ask about this".
 */
function askAbout(handle: FederatedHandle): string {
  const subject = handle.title || handle.snippet || "this";
  const trimmed = subject.replace(/\s+/g, " ").trim().slice(0, 240);
  const q = encodeURIComponent(`Tell me about: ${trimmed}`);
  return `/redesign/chat?q=${q}`;
}

export function resolveResultAction(handle: FederatedHandle): ResolvedActions {
  switch (handle.type) {
    case "nb_entities": {
      const slug = uriBody(handle.uri, "entity");
      return {
        // Workspace surface scoped to the entity reads /redesign/workspace?entity=slug.
        primaryPath: slug
          ? `/redesign/workspace?entity=${encodeURIComponent(slug)}`
          : "/redesign/workspace",
        secondaryPath: askAbout(handle),
      };
    }
    case "nb_reports": {
      const id = uriBody(handle.uri, "report");
      return {
        primaryPath: id ? `/redesign/reports/${encodeURIComponent(id)}` : "/redesign/reports",
        secondaryPath: askAbout(handle),
      };
    }
    case "nb_notebook_blocks": {
      // Blocks live under their parent report. Handle.uri is `block://id`,
      // so fall back to opening the workspace + searching for the snippet.
      return {
        primaryPath: "/redesign/workspace?tab=notebook",
        secondaryPath: askAbout(handle),
      };
    }
    case "nb_claims": {
      // Claims trace to a parent report (PR2 wires the actual report id).
      // For PR1, surface the workspace + sources view.
      return {
        primaryPath: "/redesign/workspace?tab=sources",
        secondaryPath: askAbout(handle),
      };
    }
    case "nb_sources": {
      // Sources have a real http(s) URL on `uri` when available.
      const isHttp = handle.uri.startsWith("http://") || handle.uri.startsWith("https://");
      return {
        primaryPath: isHttp ? handle.uri : "/redesign/workspace?tab=sources",
        secondaryPath: askAbout(handle),
      };
    }
    case "nb_captures": {
      return {
        primaryPath: "/redesign/inbox?lane=captures",
        secondaryPath: askAbout(handle),
      };
    }
    case "nb_threads": {
      const id = uriBody(handle.uri, "thread");
      return {
        primaryPath: id ? `/redesign/chat?thread=${encodeURIComponent(id)}` : "/redesign/chat",
        secondaryPath: askAbout(handle),
      };
    }
  }
}

/**
 * True if the resolved path is an external http(s) URL (open in new tab).
 */
export function isExternalPath(path: string): boolean {
  return path.startsWith("http://") || path.startsWith("https://");
}
