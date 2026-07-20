/**
 * DocumentPreviewDescriptor — lightweight routing type that tells the card
 * WHICH preview family to render without eagerly importing the implementation.
 *
 * The card selects a descriptor based on file metadata (type, extension, MIME).
 * The actual preview component is resolved lazily only when the card viewport
 * activates the rich preview.
 */

export type PreviewFamily =
  | "spreadsheet"
  | "code"
  | "markdown"
  | "note"
  | "image"
  | "media"
  | "empty"
  | "unknown";

export interface DocumentPreviewDescriptor {
  /** Which preview family to use */
  family: PreviewFamily;
  /** Whether the document has real content to display */
  hasContent: boolean;
  /** File type hint for family-specific parsing (e.g., "excel", "csv") */
  fileTypeHint?: string;
  /** Storage URL for content that needs fetching (spreadsheet data, images) */
  contentUrl?: string | null;
  /** Raw text content for inline preview (markdown, code) */
  contentPreview?: string | null;
  /** Pre-parsed structured data for spreadsheet preview */
  structuredPreview?: string[][] | null;
}

/**
 * Resolve a preview descriptor from document metadata.
 * This is a pure function with zero side effects — safe to call on every render
 * without importing any preview implementation.
 */
export function resolvePreviewDescriptor(doc: {
  fileType?: string;
  mimeType?: string;
  title?: string;
  contentPreview?: string | null;
  structuredPreview?: string[][] | null;
  storageUrl?: string | null;
  isEmpty?: boolean;
}): DocumentPreviewDescriptor {
  if (doc.isEmpty) {
    return { family: "empty", hasContent: false };
  }

  const type = doc.fileType?.toLowerCase() ?? "";
  const mime = doc.mimeType?.toLowerCase() ?? "";
  const title = doc.title?.toLowerCase() ?? "";

  // Spreadsheet family
  if (
    type === "csv" ||
    type === "excel" ||
    type === "spreadsheet" ||
    mime.includes("spreadsheet") ||
    mime.includes("csv") ||
    mime.includes("excel") ||
    title.endsWith(".csv") ||
    title.endsWith(".xlsx") ||
    title.endsWith(".xls")
  ) {
    return {
      family: "spreadsheet",
      hasContent: true,
      fileTypeHint: type || "csv",
      contentUrl: doc.storageUrl,
      structuredPreview: doc.structuredPreview,
    };
  }

  // Image family
  if (
    mime.startsWith("image/") ||
    /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)$/i.test(title)
  ) {
    return {
      family: "image",
      hasContent: !!doc.storageUrl,
      contentUrl: doc.storageUrl,
    };
  }

  // Media family (video/audio)
  if (
    mime.startsWith("video/") ||
    mime.startsWith("audio/") ||
    /\.(mp4|mov|webm|avi|mkv|mp3|wav|ogg)$/i.test(title)
  ) {
    return {
      family: "media",
      hasContent: !!doc.storageUrl,
      contentUrl: doc.storageUrl,
    };
  }

  // Code family
  if (
    type === "html" ||
    type === "code" ||
    type === "web" ||
    /\.(html?|js|ts|tsx|jsx|py|rb|go|rs|css|scss|sh|json)$/i.test(title)
  ) {
    return {
      family: "code",
      hasContent: !!doc.contentPreview,
      contentPreview: doc.contentPreview,
    };
  }

  // Note family (quick notes, plain text without structure)
  if (type === "note" || type === "quicknote") {
    return {
      family: "note",
      hasContent: !!doc.contentPreview,
      contentPreview: doc.contentPreview,
    };
  }

  // Markdown / document family (default for text content)
  if (
    type === "markdown" ||
    type === "document" ||
    type === "doc" ||
    /\.(md|markdown|txt)$/i.test(title) ||
    doc.contentPreview
  ) {
    return {
      family: "markdown",
      hasContent: !!doc.contentPreview,
      contentPreview: doc.contentPreview,
    };
  }

  return { family: "unknown", hasContent: false };
}
