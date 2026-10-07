/**
 * DigestSection - Morning Digest wrapper with error boundary and skeleton
 *
 * This is a thin wrapper around MorningDigest that adds:
 * - Error boundary protection
 * - Loading skeleton
 * - Standardized props interface
 */

import React, { Suspense } from 'react';
import { MorningDigest } from '../components/MorningDigest';
import { DigestSkeleton } from '@/components/skeletons';
import { ErrorBoundary, DigestErrorFallback } from "@/shared/components/ErrorBoundary";

interface DigestSectionProps {
  /** User's display name */
  userName?: string;
  /** Called when a digest item is clicked */
  onItemClick?: (item: { text: string; relevance?: string; linkedEntity?: string }) => void;
  /** Called when an entity chip is clicked */
  onEntityClick?: (entityName: string, entityType?: "company" | "person") => void;
  /** Called when refresh is requested */
  onRefresh?: () => void;
  /** Class name for container */
  className?: string;
}

function DigestSectionInner({
  userName,
  onItemClick,
  onEntityClick,
  onRefresh,
  className = '',
}: DigestSectionProps) {
  return (
    <div className={className}>
      <MorningDigest
        userName={userName}
        onItemClick={onItemClick}
        onEntityClick={onEntityClick}
        onRefresh={onRefresh}
      />
    </div>
  );
}

export function DigestSection(props: DigestSectionProps) {
  return (
    <ErrorBoundary
      section="Morning Digest"
      fallback={<DigestErrorFallback onRetry={() => window.location.reload()} />}
    >
      <Suspense fallback={<div className="min-h-[320px]"><DigestSkeleton /></div>}>
        <DigestSectionInner {...props} />
      </Suspense>
    </ErrorBoundary>
  );
}

export default DigestSection;
