/**
 * VirtualizedFeedList - High-performance feed list using react-window
 *
 * Only renders visible items, making it efficient for large feeds.
 * Falls back to regular list if react-window is not available.
 */

import React, { useMemo, useCallback, forwardRef, CSSProperties } from 'react';
import { FixedSizeList as List, ListChildComponentProps, areEqual } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { FeedCard, type FeedItem } from './FeedCard';
import { FeedCardSkeleton } from '@/components/skeletons';

interface VirtualizedFeedListProps {
  items: FeedItem[];
  onItemClick?: (item: FeedItem) => void;
  onAskAI?: (item: FeedItem) => void;
  isLoading?: boolean;
  /** Height of each item in pixels */
  itemHeight?: number;
  /** Number of skeleton items to show when loading */
  skeletonCount?: number;
  /** Class name for container */
  className?: string;
  /** Overscan count for smoother scrolling */
  overscanCount?: number;
}

// Row renderer with memoization for performance
const Row = React.memo(function Row({
  data,
  index,
  style,
}: ListChildComponentProps<{
  items: FeedItem[];
  onItemClick?: (item: FeedItem) => void;
  onAskAI?: (item: FeedItem) => void;
}>) {
  const { items, onItemClick, onAskAI } = data;
  const item = items[index];

  if (!item) return null;

  return (
    <div style={style} className="px-2 py-1.5">
      <FeedCard
        item={item}
        onClick={() => onItemClick?.(item)}
        onAnalyze={() => onAskAI?.(item)}
      />
    </div>
  );
}, areEqual);

// Outer element ref for styling
const OuterElementType = forwardRef<HTMLDivElement, { style: CSSProperties; children: React.ReactNode }>(
  ({ style, children, ...rest }, ref) => (
    <div
      ref={ref}
      style={{
        ...style,
        overflowX: 'hidden',
      }}
      {...rest}
    >
      {children}
    </div>
  )
);
OuterElementType.displayName = 'OuterElementType';

export function VirtualizedFeedList({
  items,
  onItemClick,
  onAskAI,
  isLoading = false,
  itemHeight = 160,
  skeletonCount = 6,
  className = '',
  overscanCount = 3,
}: VirtualizedFeedListProps) {
  // Memoize item data to prevent re-renders
  const itemData = useMemo(
    () => ({
      items,
      onItemClick,
      onAskAI,
    }),
    [items, onItemClick, onAskAI]
  );

  // Show skeletons while loading
  if (isLoading) {
    return (
      <div className={`space-y-3 ${className}`}>
        {Array.from({ length: skeletonCount }).map((_, i) => (
          <FeedCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  // Empty state
  if (items.length === 0) {
    return (
      <div className={`flex items-center justify-center py-12 text-content-secondary ${className}`}>
        <p className="text-sm">No items to display</p>
      </div>
    );
  }

  // For small lists (< 20 items), use regular rendering
  if (items.length < 20) {
    return (
      <div className={`space-y-3 ${className}`}>
        {items.map((item) => (
          <FeedCard
            key={item.id}
            item={item}
            onClick={() => onItemClick?.(item)}
            onAnalyze={() => onAskAI?.(item)}
          />
        ))}
      </div>
    );
  }

  // Virtualized list for large datasets
  return (
    <div className={`h-[600px] ${className}`}>
      <AutoSizer>
        {({ height, width }) => (
          <List
            height={height}
            width={width}
            itemCount={items.length}
            itemSize={itemHeight}
            itemData={itemData}
            overscanCount={overscanCount}
            outerElementType={OuterElementType}
          >
            {Row}
          </List>
        )}
      </AutoSizer>
    </div>
  );
}

/**
 * Grid version for 2-column layout
 */
interface VirtualizedFeedGridProps extends VirtualizedFeedListProps {
  /** Number of columns */
  columns?: number;
}

export function VirtualizedFeedGrid({
  items,
  onItemClick,
  onAskAI,
  isLoading = false,
  itemHeight = 180,
  skeletonCount = 6,
  className = '',
  columns = 2,
}: VirtualizedFeedGridProps) {
  // For grid, we need to chunk items into rows
  const rows = useMemo(() => {
    const result: FeedItem[][] = [];
    for (let i = 0; i < items.length; i += columns) {
      result.push(items.slice(i, i + columns));
    }
    return result;
  }, [items, columns]);

  // Show skeletons while loading
  if (isLoading) {
    return (
      <div className={`grid grid-cols-1 md:grid-cols-${columns} gap-4 ${className}`}>
        {Array.from({ length: skeletonCount }).map((_, i) => (
          <FeedCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  // Empty state
  if (items.length === 0) {
    return (
      <div className={`flex items-center justify-center py-12 text-content-secondary ${className}`}>
        <p className="text-sm">No items to display</p>
      </div>
    );
  }

  // For small lists, use regular grid
  if (items.length < 20) {
    return (
      <div className={`grid grid-cols-1 md:grid-cols-${columns} gap-4 ${className}`}>
        {items.map((item) => (
          <FeedCard
            key={item.id}
            item={item}
            onClick={() => onItemClick?.(item)}
            onAnalyze={() => onAskAI?.(item)}
          />
        ))}
      </div>
    );
  }

  // Virtualized grid using rows
  return (
    <div className={`h-[600px] ${className}`}>
      <AutoSizer>
        {({ height, width }) => (
          <List
            height={height}
            width={width}
            itemCount={rows.length}
            itemSize={itemHeight}
            itemData={{ rows, columns, onItemClick, onAskAI }}
            overscanCount={2}
            outerElementType={OuterElementType}
          >
            {GridRow}
          </List>
        )}
      </AutoSizer>
    </div>
  );
}

// Grid row renderer
const GridRow = React.memo(function GridRow({
  data,
  index,
  style,
}: ListChildComponentProps<{
  rows: FeedItem[][];
  columns: number;
  onItemClick?: (item: FeedItem) => void;
  onAskAI?: (item: FeedItem) => void;
}>) {
  const { rows, columns, onItemClick, onAskAI } = data;
  const row = rows[index];

  if (!row) return null;

  return (
    <div style={style} className="flex gap-4 px-2 py-2">
      {row.map((item) => (
        <div key={item.id} className="flex-1" style={{ minWidth: 0 }}>
          <FeedCard
            item={item}
            onClick={() => onItemClick?.(item)}
            onAnalyze={() => onAskAI?.(item)}
          />
        </div>
      ))}
      {/* Fill empty cells */}
      {Array.from({ length: columns - row.length }).map((_, i) => (
        <div key={`empty-${i}`} className="flex-1" />
      ))}
    </div>
  );
}, areEqual);

export default VirtualizedFeedList;

