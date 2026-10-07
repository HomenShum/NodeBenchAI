/**
 * FounderRouteResolver — the smart handler for `/founder` URL.
 *
 * Pattern: state-driven redirect. The `/founder` URL is promised in
 *          agent-setup.txt and the pitch, so it must always resolve to
 *          *something useful* — even for cold users who have no profile yet.
 *
 * Resolution rules (ordered):
 *   1. If user owns a self-profile (PERSON entity with YOU pill) →
 *        redirect to /entity/<their-slug>
 *   2. If founder-tagged (MCP connected / GitHub linked / lens=founder) but
 *      no profile →
 *        redirect to /?surface=me (and scroll to founder-profile section)
 *   3. Otherwise (search-only user) →
 *        redirect to /?surface=me (generic)
 *
 * See: docs/architecture/FOUNDER_FEATURE.md
 *      .claude/rules/completion_traceability.md
 *      .claude/rules/reference_attribution.md
 *
 * Prior art: Linear's workspace routing, Cursor's project-home routing.
 */

import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useConvexAuth } from "convex/react";
import { buildCockpitPath } from "@/lib/registry/viewRegistry";

/**
 * Phase 1 stub — resolves synchronously based on auth state only.
 *
 * When the Me founder-trait detection hook lands (Phase 1 Week 4+), this
 * component will query it and route based on the full three-state logic.
 * For now, signed-in users land on Me (where they can set up a profile),
 * anonymous users also land on Me (so sign-in CTA is visible in context).
 */
export default function FounderRouteResolver() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading } = useConvexAuth();

  useEffect(() => {
    if (isLoading) return;

    // Phase 1 stub: always route to Me surface with the founder-profile anchor.
    // The Me surface will conditionally render the founder section when
    // the trait detection hook fires. Non-founder-tagged users will see
    // their normal Me page.
    //
    // TODO: when useFounderTrait + self-profile query land, branch here:
    //   const hasProfile = useQuery(api.domains.product.founder.getSelfProfile)
    //   if (hasProfile?.slug) navigate(`/entity/${hasProfile.slug}`)
    const target = buildCockpitPath({ surfaceId: "connect" });
    navigate(`${target}#founder-profile`, { replace: true });
  }, [isAuthenticated, isLoading, navigate]);

  // Brief loading shell — the redirect is near-instant but we shouldn't flash
  // blank. Copy respects dogfood_verification rule (actionable + honest).
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-screen flex-col items-center justify-center gap-2 px-6 text-center"
    >
      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
        Opening your founder workspace…
      </p>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Routing based on your session state. If this doesn't redirect,{" "}
        <a
          href={buildCockpitPath({ surfaceId: "connect" })}
          className="underline decoration-dotted underline-offset-2"
        >
          open the Me surface directly
        </a>
        .
      </p>
    </div>
  );
}
