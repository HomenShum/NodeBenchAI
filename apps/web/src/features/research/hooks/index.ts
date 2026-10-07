/**
 * Research Hooks - Centralized data fetching and state management
 *
 * Usage:
 * import { useFeedData, useBriefData, useFocusSyncDebounced } from '@/features/research/hooks';
 */

export { useFeedData, FEED_CATEGORIES, type FeedCategory } from './useFeedData';
export { useBriefData } from './useBriefData';
export {
  useFocusSyncDebounced,
  useIsDataPointFocused,
  useIsSpanHovered,
  type Act,
  type FocusSource,
  type FocusState,
} from './useFocusSyncDebounced';
export { useEntityHoverData, useEntityHoverDataBatch } from './useEntityHoverData';
