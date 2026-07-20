/**
 * GitHub Explorer Component
 * Trending repository discovery with Phoenix ML ranking
 */

import React, { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Github, Star, TrendingUp, Code, ExternalLink, Tag } from "lucide-react";
import { PageHeroHeader } from "../../../shared/ui/PageHeroHeader";

export function GitHubExplorer() {
  const [selectedLanguage, setSelectedLanguage] = useState<string | undefined>(undefined);
  const [allLanguageSnapshot, setAllLanguageSnapshot] = useState<any[] | null>(null);
  const trendingRepos = useQuery(api.domains.research.githubExplorer.getTrendingRepos, {
    language: selectedLanguage,
    limit: 20,
  });

  const languages = ["TypeScript", "Python", "Rust", "Go", "JavaScript"];

  useEffect(() => {
    if (
      selectedLanguage === undefined &&
      Array.isArray(trendingRepos) &&
      trendingRepos.length > 0 &&
      allLanguageSnapshot === null
    ) {
      // NOTE(coworker): Preserve the first all-language order so returning from filters feels stable.
      setAllLanguageSnapshot(trendingRepos);
    }
  }, [selectedLanguage, trendingRepos, allLanguageSnapshot]);

  const displayRepos = useMemo(() => {
    if (!Array.isArray(trendingRepos)) return [];
    if (selectedLanguage !== undefined) return trendingRepos;
    if (allLanguageSnapshot && allLanguageSnapshot.length > 0) return allLanguageSnapshot;
    return trendingRepos;
  }, [selectedLanguage, trendingRepos, allLanguageSnapshot]);

  if (!trendingRepos) {
    return (
      <div className="nb-page-shell">
        <div className="nb-page-inner">
          <div className="nb-page-frame space-y-6">
            <PageHeroHeader
              icon={<Github className="w-5 h-5" />}
              title="GitHub Explorer"
              subtitle="Discover trending AI repositories ranked by Phoenix ML"
            />
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="nb-surface-card p-5 space-y-3 no-skeleton-animation" aria-busy="true">
                  <div className="h-5 bg-surface-secondary rounded w-2/3" />
                  <div className="h-4 bg-surface-secondary rounded w-full" />
                  <div className="h-3 bg-surface-secondary rounded w-1/4" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="nb-page-shell">
      <div className="nb-page-inner">
        <div className="nb-page-frame space-y-6">
          {/* NOTE(coworker): Keep this route on shared page-shell primitives to
              match Vercel/Linear rhythm used by Workbench and analytics views. */}
          <PageHeroHeader
            icon={<Github className="w-5 h-5" />}
            title="GitHub Explorer"
            subtitle="Discover trending AI repositories ranked by Phoenix ML"
            accent
          />

          {/* Language Filter */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setSelectedLanguage(undefined)}
              aria-pressed={selectedLanguage === undefined}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                selectedLanguage === undefined
                  ? "bg-[var(--accent-primary)] text-white border-transparent shadow-sm ring-1 ring-primary/30"
                  : "bg-surface-secondary text-content-secondary border-edge hover:text-content hover:bg-surface hover:border-edge-strong"
              }`}
            >
              {selectedLanguage === undefined ? <span className="h-1.5 w-1.5 rounded-full bg-white/90" aria-hidden="true" /> : null}
              All Languages
            </button>
            {languages.map((language) => (
              <button
                key={language}
                type="button"
                onClick={() => setSelectedLanguage(language)}
                aria-pressed={selectedLanguage === language}
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                  selectedLanguage === language
                    ? "bg-[var(--accent-primary)] text-white border-transparent shadow-sm ring-1 ring-primary/30"
                    : "bg-surface-secondary text-content-secondary border-edge hover:text-content hover:bg-surface hover:border-edge-strong"
                }`}
              >
                {selectedLanguage === language ? <span className="h-1.5 w-1.5 rounded-full bg-white/90" aria-hidden="true" /> : null}
                {language}
              </button>
            ))}
          </div>
            <p className="text-xs text-content-secondary">
              Viewing: <span className="font-medium text-content">{selectedLanguage ?? "All languages"}</span>
            </p>
          </div>

          {/* Repository List */}
          {displayRepos.length === 0 ? (
            <div className="w-full min-h-[440px] md:min-h-[500px] rounded-lg border border-edge bg-surface-secondary/40 flex flex-col items-center justify-center text-center px-6 py-16">
              <div className="w-16 h-16 bg-surface rounded-lg border border-edge flex items-center justify-center mb-4">
                <Github className="w-8 h-8 text-content-secondary" />
              </div>
              <h3 className="text-base font-semibold text-content mb-1">No repositories found</h3>
              <p className="text-sm text-content-secondary max-w-xs mx-auto">
                {selectedLanguage ? `No trending ${selectedLanguage} repositories right now.` : "No trending repositories found."}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {displayRepos.map((repo: any) => (
                <RepoCard key={repo._id} repo={repo} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface RepoCardProps {
  repo: any;
}

function RepoCard({ repo }: RepoCardProps) {
  const getPhoenixColor = (score: number) => {
    if (score >= 90) return "text-green-500";
    if (score >= 70) return "text-blue-500";
    if (score >= 50) return "text-yellow-500";
    return "text-content-secondary";
  };

  return (
    <article className="group nb-surface-card p-5 space-y-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/20 hover:shadow-md focus-within:border-primary/30 focus-within:shadow-md">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <a
              href={repo.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-lg font-semibold text-content transition-colors hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 dark:text-indigo-400"
            >
              {repo.fullName}
              <ExternalLink className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </a>
          </div>
          <p className="text-sm text-content-secondary line-clamp-2">
            {repo.description}
          </p>
        </div>
        <div
          className={`flex items-center gap-1 rounded-md bg-surface-secondary px-3 py-1.5 text-sm font-medium ring-1 ring-transparent transition-all duration-200 group-hover:ring-primary/15 ${getPhoenixColor(repo.phoenixScore)}`}
          title={`Trending score: ${repo.phoenixScore}/100`}
        >
          <TrendingUp className="w-4 h-4" />
          <span className="text-xs opacity-60 mr-0.5">Score</span>
          {repo.phoenixScore}
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-6 text-sm">
        <div className="flex items-center gap-1.5 text-content-secondary">
          <Code className="w-4 h-4" />
          <span>{repo.language}</span>
        </div>
        <div className="flex items-center gap-1.5 text-content-secondary">
          <Star className="w-4 h-4 text-yellow-500" />
          <span>{repo.stars.toLocaleString()}</span>
        </div>
        {repo.starGrowth7d > 0 && (
          <div className="flex items-center gap-1.5 text-green-500">
            <TrendingUp className="w-4 h-4" />
            <span>+{repo.starGrowth7d} (7d)</span>
          </div>
        )}
      </div>

      {/* Topics */}
      {repo.topics && repo.topics.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <Tag className="w-4 h-4 text-content-secondary" />
          {repo.topics.slice(0, 5).map((topic: string) => (
            <span
              key={topic}
              className="rounded border border-edge bg-surface-secondary px-2 py-1 text-xs text-content-secondary transition-colors duration-200 group-hover:border-edge-strong group-hover:text-content"
            >
              {topic}
            </span>
          ))}
        </div>
      )}

      {/* Relevance Reason */}
      {repo.relevanceReason && (
        <div className="pt-3 border-t border-edge">
          <p className="text-xs text-content-muted italic">
            &ldquo;{repo.relevanceReason}&rdquo;
          </p>
        </div>
      )}
    </article>
  );
}
