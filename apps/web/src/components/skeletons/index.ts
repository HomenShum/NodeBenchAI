/**
 * Skeleton Components - Shimmer placeholders for loading states
 *
 * Usage:
 * import { FeedCardSkeleton, DigestSkeleton, ViewSkeleton } from '@/components/skeletons';
 *
 * {isLoading ? <FeedGridSkeleton count={6} /> : <FeedGrid items={items} />}
 */

// Base skeleton primitives
export { 
  Skeleton, 
  SkeletonText, 
  SkeletonCircle, 
  SkeletonCard, 
  SkeletonButton, 
  SkeletonBadge 
} from './Skeleton';

// Feed skeletons
export { FeedCardSkeleton, FeedGridSkeleton } from './FeedCardSkeleton';
export { ReportCardSkeleton } from './ReportCardSkeleton';
export { DigestSkeleton } from './DigestSkeleton';
export { DealCardSkeleton, DealListSkeleton } from './DealCardSkeleton';
export { BriefingSkeleton, ActSectionSkeleton, DashboardSkeleton } from './BriefingSkeleton';

// View-specific skeletons
export { CostDashboardSkeleton } from './CostDashboardSkeleton';
export { IndustryUpdatesSkeleton } from './IndustryUpdatesSkeleton';
export { ViewSkeleton } from './ViewSkeleton';
