/**
 * AgentMetadata — Renders JSON-LD structured data in <head> for external
 * crawlers and agents that don't use WebMCP. Updates on every view change.
 *
 * Pattern: WebApplication schema with current view capabilities.
 * See: https://schema.org/WebApplication
 */

import { useEffect } from "react";
import type { MainView } from "@/lib/registry/viewRegistry";
import { getViewCapability, getAllViewCapabilities } from "@/lib/registry/viewCapabilityRegistry";

interface AgentMetadataProps {
  currentView: MainView;
  currentPath: string;
  appName?: string;
}

export function AgentMetadata({
  currentView,
  currentPath,
  appName = "NodeBench AI",
}: AgentMetadataProps) {
  useEffect(() => {
    const id = "nodebench-agent-metadata";
    let script = document.getElementById(id) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement("script");
      script.id = id;
      script.type = "application/ld+json";
      document.head.appendChild(script);
    }

    const cap = getViewCapability(currentView) ?? {
      viewId: currentView,
      title: currentView.replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()),
      description: "Interactive NodeBench workspace surface.",
      paths: [currentPath],
      dataEndpoints: [],
      actions: [],
      relatedToolCategories: [],
      tags: [currentView],
      requiresAuth: false,
    };
    const allViews = getAllViewCapabilities();

    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: appName,
      url: typeof window !== "undefined" ? window.location.origin : "",
      description:
        "AI-powered research intelligence platform with agent traversability, multi-view content discovery, and 200+ integrated tools.",
      applicationCategory: "Research & Intelligence",
      operatingSystem: "Web",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
      },
      // Current view context for agents
      mainEntity: {
        "@type": "WebPage",
        name: cap.title,
        description: cap.description,
        url: typeof window !== "undefined" ? window.location.href : currentPath,
        potentialAction: cap.actions.map((a) => ({
          "@type": "Action",
          name: a.name,
          description: a.description,
        })),
      },
      // Available views as navigation targets
      hasPart: allViews.slice(0, 10).map((v) => ({
        "@type": "WebPage",
        name: v.title,
        description: v.description,
        url: v.paths[0] || `/${v.viewId}`,
      })),
    };

    script.textContent = JSON.stringify(jsonLd);

    return () => {
      // Don't remove on unmount — leave for next mount to update
    };
  }, [currentView, currentPath, appName]);

  // This component renders nothing visible
  return null;
}
