import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { Search, X } from "lucide-react";
import { useConvexApi } from "@/lib/convexApi";
import { getAnonymousProductSessionId } from "@/features/product/lib/productIdentity";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ai-ui/dialog";

export type ProductFileAsset = {
  _id: string;
  label?: string;
  type?: string;
  mimeType?: string;
  size?: number | null;
  storageUrl?: string | null;
  updatedAt?: number;
};

type ProductFileAssetPickerProps = {
  open: boolean;
  title: string;
  description: string;
  actionLabel: string;
  onClose: () => void;
  onSelect: (file: ProductFileAsset) => void | Promise<void>;
};

function formatBytes(size?: number | null) {
  if (!size || !Number.isFinite(size)) return null;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function ProductFileAssetPicker({
  open,
  title,
  description,
  actionLabel,
  onClose,
  onSelect,
}: ProductFileAssetPickerProps) {
  const api = useConvexApi();
  const anonymousSessionId = getAnonymousProductSessionId();
  const [query, setQuery] = useState("");
  const files = useQuery(
    api?.domains?.product?.me?.listFiles ?? "skip",
    api?.domains?.product?.me?.listFiles ? { anonymousSessionId } : "skip",
  ) as ProductFileAsset[] | undefined;

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const source = files ?? [];
    if (!normalizedQuery) return source;
    return source.filter((file) => {
      const haystacks = [file.label, file.mimeType, file.type]
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.toLowerCase());
      return haystacks.some((value) => value.includes(normalizedQuery));
    });
  }, [files, query]);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent
        className="bottom-4 top-auto w-[calc(100%-2rem)] max-w-[560px] translate-y-0 gap-0 rounded-[28px] border-black/10 bg-white p-0 shadow-2xl sm:bottom-auto sm:top-[50%] sm:translate-y-[-50%] dark:border-white/10 dark:bg-[#101418]"
        overlayClassName="bg-black/45"
        showCloseButton={false}
      >
        <div className="flex items-start justify-between gap-3 border-b border-black/5 px-5 py-4 dark:border-white/8">
          <div>
            <DialogTitle className="text-base font-semibold text-gray-900 dark:text-gray-100">{title}</DialogTitle>
            <DialogDescription className="mt-1 text-sm text-gray-500 dark:text-gray-400">{description}</DialogDescription>
          </div>
          <DialogClose asChild>
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-black/10 text-gray-500 transition hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]/40 dark:border-white/10 dark:text-gray-400 dark:hover:text-gray-100"
              aria-label="Close file picker"
            >
              <X className="h-4 w-4" />
            </button>
          </DialogClose>
        </div>

        <div className="border-b border-black/5 px-5 py-4 dark:border-white/8">
          <label className="flex items-center gap-3 rounded-2xl border border-black/8 bg-black/[0.02] px-3 py-2 dark:border-white/10 dark:bg-white/[0.03]">
            <Search className="h-4 w-4 text-gray-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search files"
              className="w-full bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-400 dark:text-gray-100 dark:placeholder:text-gray-500"
            />
          </label>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-3 py-3">
          {files === undefined ? (
            <div className="rounded-2xl border border-dashed border-black/10 px-4 py-5 text-sm text-gray-500 dark:border-white/10 dark:text-gray-400">
              Loading files...
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-black/10 px-4 py-5 text-sm text-gray-500 dark:border-white/10 dark:text-gray-400">
              No matching files yet. Upload in Me or from Chat first.
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((file) => (
                <button
                  key={String(file._id)}
                  type="button"
                  onClick={() => void onSelect(file)}
                  className="flex w-full items-center justify-between gap-3 rounded-2xl border border-black/8 px-4 py-3 text-left transition hover:border-[var(--accent-primary)]/30 hover:bg-[var(--accent-primary)]/4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]/30 dark:border-white/10 dark:hover:border-[var(--accent-primary)]/35 dark:hover:bg-[var(--accent-primary)]/8"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                      {file.label || "Untitled file"}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-gray-500 dark:text-gray-400">
                      {file.type ? <span className="capitalize">{file.type}</span> : null}
                      {file.mimeType ? <span>{file.mimeType}</span> : null}
                      {formatBytes(file.size) ? <span>{formatBytes(file.size)}</span> : null}
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full bg-[var(--accent-primary)] px-3 py-1 text-xs font-medium text-white">
                    {actionLabel}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ProductFileAssetPicker;
