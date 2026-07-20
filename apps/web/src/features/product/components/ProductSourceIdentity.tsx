import { cn } from "@/lib/utils";

type ProductSourceIdentityProps = {
  sourceUrls?: string[];
  sourceLabels?: string[];
  maxItems?: number;
  className?: string;
};

function deriveSourceDomains(urls: string[]) {
  const seen = new Set<string>();
  const domains: string[] = [];
  for (const href of urls) {
    try {
      const domain = new URL(href).hostname.replace(/^www\./, "");
      if (!domain || seen.has(domain)) continue;
      seen.add(domain);
      domains.push(domain);
    } catch {
      continue;
    }
  }
  return domains;
}

const DOMAIN_TONES = [
  "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-200",
  "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-200",
  "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/20 dark:bg-violet-500/10 dark:text-violet-200",
  "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-100",
  "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200",
  "border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-500/20 dark:bg-cyan-500/10 dark:text-cyan-200",
];

function getDomainTone(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return DOMAIN_TONES[hash % DOMAIN_TONES.length];
}

function getBadgeText(value: string) {
  const core = value.replace(/\.[^.]+$/, "").replace(/[^a-z0-9]/gi, "");
  return core.slice(0, 2).toUpperCase() || value.slice(0, 1).toUpperCase();
}

export function ProductSourceIdentity({
  sourceUrls,
  sourceLabels,
  maxItems = 3,
  className,
}: ProductSourceIdentityProps) {
  const domains = deriveSourceDomains(sourceUrls ?? []).slice(0, maxItems);
  const labels = domains.length
    ? []
    : (sourceLabels ?? [])
        .map((label) => label.trim())
        .filter(Boolean)
        .slice(0, maxItems);
  const hiddenCount = Math.max(
    0,
    (domains.length > 0 ? deriveSourceDomains(sourceUrls ?? []).length : (sourceLabels ?? []).filter(Boolean).length) -
      (domains.length > 0 ? domains.length : labels.length),
  );

  if (domains.length === 0 && labels.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {domains.map((domain) => (
        <span
          key={domain}
          className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-2 py-1 text-[10px] font-medium text-gray-500 dark:border-white/[0.1] dark:bg-white/[0.04] dark:text-gray-400"
        >
          <span
            aria-hidden="true"
            className={cn(
              "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-md border text-[8px] font-semibold tracking-[0.08em]",
              getDomainTone(domain),
            )}
          >
            {getBadgeText(domain)}
          </span>
          <span className="truncate">{domain}</span>
        </span>
      ))}
      {domains.length === 0
        ? labels.map((label) => (
            <span
              key={label}
              className="inline-flex max-w-full items-center rounded-full border border-gray-200 bg-gray-50 px-2 py-1 text-[10px] font-medium text-gray-500 dark:border-white/[0.1] dark:bg-white/[0.04] dark:text-gray-400"
            >
              <span className="truncate">{label}</span>
            </span>
          ))
        : null}
      {hiddenCount > 0 ? (
        <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500">
          +{hiddenCount} more
        </span>
      ) : null}
    </div>
  );
}

export default ProductSourceIdentity;
