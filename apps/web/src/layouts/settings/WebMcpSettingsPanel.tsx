/**
 * WebMcpSettingsPanel — Manage approved WebMCP origins and provider toggle.
 *
 * Ive-style minimal panel:
 * - List of approved origins with tool count and last scan timestamp
 * - Inline "Add origin" form (URL + label)
 * - Per-origin expand: cached tool names, revoke button
 * - Provider toggle (on/off, stored in localStorage)
 */

import React, { useState, useCallback } from "react";
import { useQuery, useMutation} from "convex/react";
import { useConvexApi } from "@/lib/convexApi";
import { toast } from "sonner";
import { Globe, Plus, Trash2, ChevronDown, ChevronRight, ToggleLeft, ToggleRight } from "lucide-react";

const PROVIDER_KEY = "nodebench_webmcp_provider_enabled";

export function WebMcpSettingsPanel() {
  const api = useConvexApi();

  const origins = useQuery(api?.domains.mcp.webmcpOriginManager.listApprovedOrigins);
  const approve = useMutation(api?.domains.mcp.webmcpOriginManager.approveOrigin);
  const revoke = useMutation(api?.domains.mcp.webmcpOriginManager.revokeOrigin);

  const [newUrl, setNewUrl] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [providerEnabled, setProviderEnabled] = useState(
    () => localStorage.getItem(PROVIDER_KEY) === "true"
  );

  const handleAdd = useCallback(async () => {
    const url = newUrl.trim();
    const label = newLabel.trim() || new URL(url).hostname;
    if (!url) return;

    try {
      new URL(url);
    } catch {
      toast.error("Invalid URL");
      return;
    }

    if (!url.startsWith("https://")) {
      toast.error("HTTPS required for browser tool sites");
      return;
    }

    try {
      await approve({ origin: new URL(url).origin, label });
      setNewUrl("");
      setNewLabel("");
      toast.success(`Origin approved: ${label}`);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to approve origin");
    }
  }, [newUrl, newLabel, approve]);

  const handleRevoke = useCallback(
    async (originId: any) => {
      try {
        await revoke({ originId });
        toast.success("Origin revoked");
      } catch (e: any) {
        toast.error(e.message ?? "Failed to revoke origin");
      }
    },
    [revoke]
  );

  const toggleProvider = useCallback(() => {
    const next = !providerEnabled;
    setProviderEnabled(next);
    localStorage.setItem(PROVIDER_KEY, String(next));
    toast.success(next ? "Browser tools enabled" : "Browser tools disabled");
  }, [providerEnabled]);

  return (
    <div className="space-y-6">
      {/* Provider Toggle */}
      <div className="rounded-lg border border-edge bg-surface p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-content">
              Browser Tools Provider
            </h3>
            <p className="text-xs text-content-secondary mt-0.5">
              Expose tools to browser agents via the Model Context Protocol
            </p>
          </div>
          <button
            onClick={toggleProvider}
            className="text-content-secondary hover:text-content transition-colors"
            aria-label={providerEnabled ? "Disable provider" : "Enable provider"}
          >
            {providerEnabled ? (
              <ToggleRight className="w-6 h-6 text-blue-500" />
            ) : (
              <ToggleLeft className="w-6 h-6" />
            )}
          </button>
        </div>
      </div>

      {/* Approved Origins */}
      <div className="rounded-lg border border-edge bg-surface p-4">
        <h3 className="text-sm font-semibold text-content mb-3">
          Approved Origins
        </h3>

        {/* Add Origin Form */}
        <div className="flex gap-2 mb-4">
          <input
            type="url"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            placeholder="https://example.com"
            className="flex-1 text-xs px-2.5 py-1.5 rounded border border-edge bg-transparent text-content placeholder:text-content-muted focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <input
            type="text"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="Label (optional)"
            className="w-32 text-xs px-2.5 py-1.5 rounded border border-edge bg-transparent text-content placeholder:text-content-muted focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <button
            onClick={handleAdd}
            disabled={!newUrl.trim()}
            className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add
          </button>
        </div>

        {/* Origins List */}
        <div className="space-y-2">
          {!origins ? (
            <p className="text-xs text-content-muted italic">Loading...</p>
          ) : origins.length === 0 ? (
            <p className="text-xs text-content-muted">
              No approved origins yet. Add a compatible site above.
            </p>
          ) : (
            origins.map((origin) => (
              <div
                key={origin._id}
                className="rounded border border-edge bg-gray-50/50 dark:bg-white/[0.01] p-3"
              >
                <div className="flex items-center justify-between">
                  <button
                    onClick={() =>
                      setExpandedId(expandedId === origin._id ? null : origin._id)
                    }
                    className="flex items-center gap-2 text-left flex-1 min-w-0"
                  >
                    {expandedId === origin._id ? (
                      <ChevronDown className="w-3.5 h-3.5 text-content-muted flex-shrink-0" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-content-muted flex-shrink-0" />
                    )}
                    <Globe className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                    <span className="text-xs font-medium text-content truncate">
                      {origin.label}
                    </span>
                    <span className="text-xs text-content-muted truncate">
                      {origin.origin}
                    </span>
                  </button>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {origin.discoveredToolCount !== undefined && (
                      <span className="text-xs text-content-muted">
                        {origin.discoveredToolCount} tools
                      </span>
                    )}
                    <button
                      onClick={() => handleRevoke(origin._id)}
                      className="text-content-muted hover:text-red-500 transition-colors"
                      aria-label="Revoke origin"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {expandedId === origin._id && (
                  <div className="mt-2 pl-7 space-y-1">
                    <div className="text-xs text-content-muted">
                      Approved: {origin.approvedAt ? new Date(origin.approvedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : "—"}
                    </div>
                    {origin.lastDiscoveredAt && (
                      <div className="text-xs text-content-muted">
                        Last scanned: {new Date(origin.lastDiscoveredAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </div>
                    )}
                    {origin.allowedToolPatterns && origin.allowedToolPatterns.length > 0 && (
                      <div className="text-xs text-content-muted">
                        Allowed: {origin.allowedToolPatterns.join(", ")}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
