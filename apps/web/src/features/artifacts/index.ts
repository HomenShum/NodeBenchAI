/**
 * Artifacts Feature — Object-first artifact display and management.
 *
 * @example
 * ```tsx
 * import { ArtifactProvider, ArtifactHost, ArtifactTabs, useArtifact } from '@/features/artifacts';
 *
 * <ArtifactProvider>
 *   <ArtifactHost
 *     title="Stripe Research"
 *     activeTab="brief"
 *     onTabChange={(tab) => console.log(tab)}
 *   />
 * </ArtifactProvider>
 * ```
 */

// Components
export { ArtifactHost } from "./components/ArtifactHost";
export { ArtifactTabs, ArtifactTabsVertical } from "./components/ArtifactTabs";

// Context
export {
  ArtifactProvider,
  useArtifact,
  useArtifactOptional,
} from "./context/ArtifactContext";

// Types
export type {
  ArtifactTab,
} from "./components/ArtifactTabs";

export type {
  ArtifactType,
  ArtifactMode,
  ArtifactState,
} from "./context/ArtifactContext";

// Views
export { ObjectFirstDemo } from "./views/ObjectFirstDemo";
