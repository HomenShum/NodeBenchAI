/**
 * ResourceLinkCard.tsx
 * UI renderer for MCP-style resource_link outputs.
 *
 * Shows preview + metadata and provides a bounded retrieval CTA (retrieveArtifact).
 */

import React, { useMemo, useState } from 'react';
import { useAction } from 'convex/react';
import { api } from '../../../../../convex/_generated/api';
import { cn } from '@/lib/utils';
import { ExternalLink, FileText, Loader2, Search, Copy, Check } from 'lucide-react';

export type ResourceLink = {
  type: 'resource_link';
  resourceId: string;
  artifactId: string;
  mimeType: string;
  sizeBytes: number;
  preview: string;
  title?: string;
  retrievalHint?: {
    query?: string;
    budget?: number;
    chunkIds?: string[];
  };
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function truncateMiddle(s: string, max: number): string {
  if (!s) return s;
  if (s.length <= max) return s;
  const head = Math.max(6, Math.floor(max * 0.55));
  const tail = Math.max(6, max - head - 3);
  return `${s.slice(0, head)}...${s.slice(-tail)}`;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

type Props = {
  resourceLink: ResourceLink;
  className?: string;
  variant?: 'default' | 'compact';
};

export function ResourceLinkCard({ resourceLink, className, variant = 'default' }: Props) {
  const retrieveArtifact = useAction(api.tools.context.retrieveArtifact.retrieveArtifact);
  const [query, setQuery] = useState(resourceLink.retrievalHint?.query ?? 'key facts');
  const [budget, setBudget] = useState<number>(resourceLink.retrievalHint?.budget ?? 2000);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [excerpts, setExcerpts] = useState<Array<{ text: string; anchor: string }>>([]);

  const title = useMemo(() => {
    if (isNonEmptyString(resourceLink.title)) return resourceLink.title.trim();
    return 'Stored tool output';
  }, [resourceLink.title]);

  const handleRetrieve = async () => {
    setLoading(true);
    setError(null);
    try {
      const res: any = await retrieveArtifact({
        artifactId: resourceLink.artifactId as any,
        resourceId: resourceLink.resourceId as any,
        query,
        budget,
      } as any);

      const next = Array.isArray(res?.excerpts)
        ? res.excerpts
            .map((e: any) => ({
              text: String(e?.text ?? ''),
              anchor: String(e?.citation?.anchor ?? ''),
            }))
            .filter((e: any) => e.text.trim().length > 0)
        : [];
      setExcerpts(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className={cn(
        'rounded-lg border border-edge bg-surface',
        variant === 'compact' ? 'p-3' : 'p-4',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-blue-600" />
            <div className="text-sm font-semibold text-content truncate">{title}</div>
          </div>
          <div className="mt-1 text-xs text-content-secondary flex flex-wrap gap-x-3 gap-y-1">
            <span>Size: {formatBytes(resourceLink.sizeBytes)}</span>
            <span>Type: {resourceLink.mimeType}</span>
            <span>Artifact: <code className="px-1 rounded bg-surface-secondary">{truncateMiddle(resourceLink.artifactId, 22)}</code></span>
            <span>Link: <code className="px-1 rounded bg-surface-secondary">{truncateMiddle(resourceLink.resourceId, 22)}</code></span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <CopyIdButton label="Copy artifactId" value={resourceLink.artifactId} />
          <CopyIdButton label="Copy resourceId" value={resourceLink.resourceId} />
        </div>
      </div>

      {isNonEmptyString(resourceLink.preview) && (
        <div className={cn('mt-3 rounded-md border border-edge bg-surface-secondary', variant === 'compact' ? 'p-2' : 'p-3')}>
          <div className="text-xs font-medium text-content-secondary mb-1">Preview</div>
          <pre className="text-xs text-content whitespace-pre-wrap break-words max-h-40 overflow-auto">
            {resourceLink.preview}
          </pre>
        </div>
      )}

      <div className={cn('mt-3 flex items-center gap-2 flex-wrap', variant === 'compact' ? 'text-xs' : 'text-sm')}>
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-content-secondary" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-9 px-3 rounded-md border border-edge bg-surface text-content w-[260px] max-w-full"
            placeholder="Query (e.g., pricing, dates, founders)"
          />
          <input
            value={String(budget)}
            onChange={(e) => setBudget(Math.max(100, Math.min(8000, Number(e.target.value || 0))))}
            className="h-9 px-3 rounded-md border border-edge bg-surface text-content w-[110px]"
            placeholder="Budget"
            inputMode="numeric"
          />
        </div>
        <button
          onClick={handleRetrieve}
          disabled={loading || !query.trim()}
          className={cn(
            'h-9 px-3 rounded-md border transition-colors flex items-center gap-2',
            loading ? 'opacity-70 cursor-not-allowed' : 'hover:bg-surface-hover',
            'border-edge bg-surface-secondary text-content',
          )}
        >
          {loading ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" /> : <ExternalLink className="h-4 w-4" />}
          Retrieve excerpts
        </button>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>

      {excerpts.length > 0 && (
        <div className="mt-3 space-y-2">
          <div className="text-xs font-medium text-content-secondary">Top excerpts</div>
          {excerpts.map((e, idx) => (
            <div key={idx} className="rounded-md border border-edge bg-surface p-3">
              <div className="text-xs text-[var(--text-tertiary)] mb-1">
                <code className="bg-surface-secondary px-1 rounded">{e.anchor || '{{cite:...}}'}</code>
              </div>
              <div className="text-xs text-content whitespace-pre-wrap break-words">
                {e.text}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CopyIdButton({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="h-8 px-2 rounded-md border border-edge bg-surface-secondary text-content-secondary hover:text-content hover:bg-surface-hover transition-colors flex items-center gap-1"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          // ignore
        }
      }}
      aria-label={label}
      title={label}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

