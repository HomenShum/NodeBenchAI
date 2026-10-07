/**
 * Route-level wrapper for /me/wiki. Resolves ownerKey from the product
 * bootstrap (anonymous session id for guests, auth identity when signed
 * in) and mounts the presentational WikiLanding.
 */
import { getAnonymousProductSessionId } from "@/features/product/lib/productIdentity";
import { useProductBootstrap } from "@/features/product/lib/useProductBootstrap";
import { WikiLanding } from "./WikiLanding";

export default function WikiLandingRoute() {
  useProductBootstrap();
  const ownerKey = getAnonymousProductSessionId();
  return <WikiLanding ownerKey={ownerKey} />;
}
