/**
 * PublicEntityShareView — bridge /share/{token} into the canonical entity page.
 *
 * Route: /share/{token}
 * Auth:  none — the token itself is the credential.
 *
 * Canonical target:
 *   /entity/:slug?share={token}&view=read
 *
 * This keeps share mode on the same notebook/report surface instead of
 * maintaining a second report tree for public reading.
 */

import { useEffect } from "react";
import { useMutation, useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";

import { api } from "../../../../convex/_generated/api";
import { buildEntityPath } from "@/features/entities/lib/entityExport";
import { describeShareStatus, parseShareTokenFromPath } from "./publicShareHelpers";

type ShareContext =
  | { status: "not_found" }
  | { status: "revoked" }
  | { status: "expired" }
  | {
      status: "active";
      resourceType: string;
      resourceSlug: string;
      label?: string;
      createdAt: number;
    };

function getTokenFromPath(): string | null {
  const path = typeof window !== "undefined" ? window.location.pathname : "";
  return parseShareTokenFromPath(path);
}

function StatusCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto mt-24 max-w-md rounded-lg border border-zinc-200 bg-white p-6 text-center shadow-sm dark:border-white/[0.08] dark:bg-zinc-900">
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-white">{title}</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{body}</p>
      <a
        href="/"
        className="mt-4 inline-block rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-white/[0.1] dark:text-zinc-300 dark:hover:bg-white/[0.04]"
      >
        Back to NodeBench
      </a>
    </div>
  );
}

export default function PublicEntityShareView() {
  const navigate = useNavigate();
  const token = getTokenFromPath();

  const shareContext = useQuery(
    api.domains.product.publicShares.getPublicShareContext,
    token ? { token } : "skip",
  ) as ShareContext | undefined;

  const recordView = useMutation(api.domains.product.publicShares.recordPublicView);

  useEffect(() => {
    if (!token || shareContext?.status !== "active") return;
    if (shareContext.resourceType !== "entity") return;

    recordView({ token }).catch(() => {
      // Nice-to-have analytics only.
    });

    navigate(`${buildEntityPath(shareContext.resourceSlug, token)}&view=read`, {
      replace: true,
    });
  }, [navigate, recordView, shareContext, token]);

  if (!token) {
    return (
      <StatusCard
        title="No share token"
        body="This URL is missing a token. Ask the sender for a fresh link."
      />
    );
  }

  if (shareContext === undefined) {
    return (
      <div
        className="mx-auto mt-24 max-w-md rounded-lg border border-zinc-200 bg-white p-6 dark:border-white/[0.08] dark:bg-zinc-900"
        role="status"
        aria-busy="true"
      >
        <div className="h-5 w-40 rounded bg-zinc-200 motion-safe:animate-pulse dark:bg-white/[0.06]" />
        <div className="mt-3 h-4 w-full rounded bg-zinc-200 motion-safe:animate-pulse dark:bg-white/[0.06]" />
        <div className="mt-2 h-4 w-4/5 rounded bg-zinc-200 motion-safe:animate-pulse dark:bg-white/[0.06]" />
      </div>
    );
  }

  if (shareContext.status !== "active") {
    const desc = describeShareStatus(shareContext.status);
    return <StatusCard title={desc.title} body={desc.body} />;
  }

  return (
    <div
      className="mx-auto mt-24 max-w-md rounded-lg border border-zinc-200 bg-white p-6 dark:border-white/[0.08] dark:bg-zinc-900"
      role="status"
      aria-busy="true"
    >
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-white">
        Opening {shareContext.label ?? shareContext.resourceSlug}
      </h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Redirecting to the shared read-only notebook.
      </p>
    </div>
  );
}
