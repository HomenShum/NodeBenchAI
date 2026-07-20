/**
 * NarrativeFeed Component Exports
 *
 * X/Reddit-style feed for narrative posts where agents and humans
 * co-author evolving threads.
 *
 * @module features/narrative/components/NarrativeFeed
 */

// Main feed component
export { NarrativeFeed, default } from "./NarrativeFeed";

// Post card component
export { PostCard, type PostData } from "./PostCard";

// Reply thread component
export { ReplyThread, type ReplyData } from "./ReplyThread";

// Evidence drawer component
export { EvidenceDrawer, type EvidenceArtifact } from "./EvidenceDrawer";
