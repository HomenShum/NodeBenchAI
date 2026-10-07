/**
 * WikiThemesPanel — Displays extracted themes from REFLECT phase
 *
 * Themes are derived observations, not truth-bearing facts.
 * They help users discover connections across their wiki pages.
 */

import { useQuery } from "convex/react";
import { Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { useConvexApi } from "@/lib/convexApi";

interface Theme {
  _id: string;
  themeId: string;
  label: string;
  description: string;
  relatedPageSlugs: string[];
  confidence: number;
}

export function WikiThemesPanel({ ownerKey }: { ownerKey: string }) {
  const api = useConvexApi();
  const themes = useQuery(
    api?.domains?.product?.wikiStagingMutations?.listWikiThemes ?? "skip",
    api?.domains?.product?.wikiStagingMutations?.listWikiThemes
      ? { ownerKey, limit: 10 }
      : "skip",
  ) as Theme[] | undefined;

  if (!themes || themes.length === 0) {
    return null;
  }

  return (
    <section
      data-testid="wiki-themes-panel"
      className="rounded-lg border border-amber-200/50 bg-amber-50/30 p-4 dark:border-amber-500/20 dark:bg-amber-500/5"
    >
      <div className="mb-3 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        <h3 className="text-sm font-medium text-amber-800 dark:text-amber-200">
          Themes from your wiki
        </h3>
        <span className="text-[11px] text-amber-600/70 dark:text-amber-400/70">
          (REFLECT phase)
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {themes.map((theme) => (
          <div
            key={theme._id}
            className="group relative inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-white px-3 py-1.5 text-xs dark:border-amber-500/30 dark:bg-white/5"
          >
            <span className="font-medium text-gray-800 dark:text-gray-200">
              {theme.label}
            </span>
            <span className="text-[10px] text-gray-500 dark:text-gray-400">
              {Math.round(theme.confidence * 100)}%
            </span>

            {/* Tooltip */}
            <div className="absolute bottom-full left-1/2 z-10 mb-2 hidden w-48 -translate-x-1/2 rounded-lg border border-gray-200 bg-white p-2 text-xs shadow-lg group-hover:block dark:border-white/10 dark:bg-gray-800">
              <p className="text-gray-600 dark:text-gray-300">{theme.description}</p>
              {theme.relatedPageSlugs.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {theme.relatedPageSlugs.slice(0, 3).map((slug) => (
                    <Link
                      key={slug}
                      to={`/me/wiki/topic/${slug}`}
                      className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600 hover:bg-gray-200 dark:bg-white/10 dark:text-gray-400 dark:hover:bg-white/15"
                    >
                      {slug}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
