import { useEffect, useMemo, useRef } from "react";
import { useConvex, useConvexAuth } from "convex/react";
import { useConvexApi } from "@/lib/convexApi";
import { getAnonymousProductSessionId } from "./productIdentity";

export function useProductBootstrap() {
  const api = useConvexApi();
  const convex = useConvex();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const bootstrappedKeyRef = useRef<string | null>(null);
  const anonymousSessionId = useMemo(() => getAnonymousProductSessionId(), []);
  const bootstrapKey = `${isAuthenticated ? "user" : "anon"}:${anonymousSessionId ?? "none"}`;

  useEffect(() => {
    if (!api?.domains.product.bootstrap.ensureCanonicalProductBootstrap) return;
    if (isLoading) return;
    if (bootstrappedKeyRef.current === bootstrapKey) return;
    bootstrappedKeyRef.current = bootstrapKey;

    void convex
      .mutation(api.domains.product.bootstrap.ensureCanonicalProductBootstrap, {
        anonymousSessionId,
      })
      .catch((error) => {
        if (bootstrappedKeyRef.current === bootstrapKey) {
          bootstrappedKeyRef.current = null;
        }
        console.error("[product] bootstrap failed", error);
      });
  }, [anonymousSessionId, api, bootstrapKey, convex, isLoading]);
}
