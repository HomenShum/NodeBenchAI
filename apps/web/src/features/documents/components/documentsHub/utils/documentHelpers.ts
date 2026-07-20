/**
 * Document Helper Functions
 * 
 * Utility functions for handling documents
 */

import { Id } from "../../../../../../convex/_generated/dataModel";
import { FileType, inferFileType } from "@/lib/fileTypes";
import { FileText, Calendar, File } from "lucide-react";

export type DocumentCardData = {
  _id: Id<"documents">;
  title: string;
  contentPreview: string | null;
  documentType: "file" | "text" | "timeline";
  fileType?: string;
  fileName?: string;
  fileId?: Id<"files">;
  lastModified?: number;
  tags?: string[];
  // Harmonized flags expected by tests
  isFavorite?: boolean;
  isArchived?: boolean;
  createdAt?: number;
  updatedAt?: number;
  createdBy?: string;
  coverImage?: string;
  icon?: string;
  // AI indexing status fields
  ragIndexedAt?: number;
  fileSearchIndexedAt?: number;
  analyzedAt?: number;
  // File metadata
  fileSize?: number;
  rowCount?: number; // For CSV/spreadsheets
  // Image thumbnail URL (for image files)
  thumbnailUrl?: string | null;
  // Media URL for playable media (images and videos)
  mediaUrl?: string | null;
  // CSV URL for spreadsheet preview
  csvUrl?: string | null;
};

/** AI indexing status for visual indicators */
export type AIStatus = 'indexed' | 'processing' | 'raw';

/** Get the AI indexing status for a document */
export function getAIStatus(doc: DocumentCardData): AIStatus {
  if (doc.ragIndexedAt || doc.fileSearchIndexedAt || doc.analyzedAt) {
    return 'indexed';
  }
  // Could add logic for "processing" state if we track that
  return 'raw';
}

/**
 * Normalize a document object to DocumentCardData format
 */
export function normalizeDocument(d: any): DocumentCardData {
  const title = (d?.title ?? "Untitled") as string;
  const contentPreview = (d?.contentPreview ?? null) as string | null;

  // Determine document type
  let documentType: "file" | "text" | "timeline" = "text";
  let fileType: string | undefined;
  let fileName: string | undefined;
  let fileId: Id<"files"> | undefined;

  if (d?.documentType === "file" || d?.fileId) {
    documentType = "file";
    fileType = d?.fileType;
    fileName = d?.fileName ?? d?.title;
    fileId = d?.fileId;
  } else if (d?.documentType === "timeline") {
    documentType = "timeline";
  }

  return {
    _id: d?._id,
    title,
    contentPreview,
    documentType,
    fileType,
    fileName,
    fileId,
    lastModified: d?.lastModified,
    tags: d?.tags,
    isFavorite: d?.isFavorite ?? d?.favorite ?? false,
    isArchived: d?.isArchived ?? d?.archived ?? false,
    createdAt: d?._creationTime ?? d?.createdAt ?? 0,
    updatedAt: d?.updatedAt,
    createdBy: d?.createdBy,
    coverImage: d?.coverImage,
    icon: d?.icon,
    // AI indexing status
    ragIndexedAt: d?.ragIndexedAt,
    fileSearchIndexedAt: d?.fileSearchIndexedAt,
    analyzedAt: d?.analyzedAt,
    // File metadata
    fileSize: d?.fileSize,
    rowCount: d?.rowCount,
    // Image thumbnail URL
    thumbnailUrl: d?.thumbnailUrl,
    // Media URL for playable media (images and videos)
    mediaUrl: d?.mediaUrl,
    // CSV URL for spreadsheet preview
    csvUrl: d?.csvUrl,
  };
}

/**
 * Get the appropriate icon for a document type
 */
export const getDocumentTypeIcon = (doc: DocumentCardData) => {
  let t: FileType | "timeline" | "markdown";

  if (doc.documentType === "file" && doc.fileType) {
    t = inferFileType(doc.fileType as any);
  } else if (doc.documentType === "timeline") {
    t = "timeline";
  } else {
    t = "text";
  }

  switch (t as string) {
    case "timeline":
      return Calendar;
    case "text":
    case "markdown":
      return FileText;
    default:
      return File;
  }
};

