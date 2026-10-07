/**
 * Shared UI — Single source of truth for all UI primitives.
 *
 * Import from: '@/shared/ui' or '@shared/ui'
 * Legacy imports from '@/components/ui' are re-exported for backward compatibility.
 */

// Core primitives
export { Button, IconButton } from "./Button";
export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "./Card";
export { SidebarButton } from "./SidebarButton";
export { Sparkline } from "./Sparkline";
export { ToastProvider, useToast } from "./Toast";
export { EmptyState } from "./EmptyState";
export { SourceChip } from "./SourceChip";
export type { SourceChipProps, SourceChipTone, SourceChipSize } from "./SourceChip";

// Extended primitives
export { Badge } from "./Badge";
export type { BadgeTone } from "./Badge";
export { PageHeroHeader } from "./PageHeroHeader";
export { PresetChip } from "./PresetChip";
export { SidebarMiniCalendar } from "./SidebarMiniCalendar";
export { SidebarUpcoming } from "./SidebarUpcoming";
export { SignatureOrb } from "./SignatureOrb";
export { Tooltip } from "./Tooltip";
export { TopDividerBar } from "./TopDividerBar";
export { UnifiedHubPills } from "./UnifiedHubPills";

// Surface primitives — unified design language for all cockpit surfaces
export {
  SurfaceCard,
  SurfaceSection,
  SurfaceBadge,
  SurfaceTabs,
  SurfaceStat,
  SurfaceChip,
  SurfaceButton,
  SurfacePageHeader,
  SurfaceScroll,
  SurfaceGrid,
  SurfaceDivider,
  scoreToBadgeTone,
  labelToBadgeTone,
} from "./SurfacePrimitives";
