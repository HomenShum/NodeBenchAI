import type { UIMessage } from "@convex-dev/agent/react";

import { convexToUIParts } from "./adapters/convexToUIParts";
import {
  extractDocumentActionsFromToolOutput,
  type DocumentAction,
} from "./DocumentActionCard";
import {
  extractMediaFromText,
  type ExtractedMedia,
  type WebSource,
} from "./utils/mediaExtractor";

export interface ConsultedArtifacts {
  media: ExtractedMedia;
  documents: DocumentAction[];
}

function emptyMedia(): ExtractedMedia {
  return {
    youtubeVideos: [],
    secDocuments: [],
    webSources: [],
    profiles: [],
    images: [],
  };
}

function mergeMedia(target: ExtractedMedia, next: ExtractedMedia): void {
  target.youtubeVideos.push(...next.youtubeVideos);
  target.secDocuments.push(...next.secDocuments);
  target.webSources.push(...next.webSources);
  target.profiles.push(...next.profiles);
  target.images.push(...next.images);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function parseStructuredOutput(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  if (record) return record;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  try {
    return asRecord(JSON.parse(trimmed));
  } catch {
    return null;
  }
}

function structuredSources(value: unknown): WebSource[] {
  const output = parseStructuredOutput(value);
  const data = asRecord(output?.data);
  if (!data || !Array.isArray(data.sources)) return [];

  return data.sources.flatMap((item): WebSource[] => {
    const source = asRecord(item);
    const url = typeof source?.url === "string" ? source.url.trim() : "";
    if (!url) return [];
    return [{
      title:
        typeof source?.title === "string" && source.title.trim()
          ? source.title.trim()
          : url,
      url,
      domain: typeof source?.domain === "string" ? source.domain : undefined,
      description:
        typeof source?.description === "string"
          ? source.description
          : typeof source?.snippet === "string"
            ? source.snippet
            : undefined,
      publishedAt:
        typeof source?.publishedAt === "string"
          ? source.publishedAt
          : undefined,
    }];
  });
}

function outputText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function dedupe<T>(items: T[], keyOf: (item: T) => string | undefined): T[] {
  const unique = new Map<string, T>();
  for (const item of items) {
    const key = keyOf(item)?.trim();
    if (key && !unique.has(key)) unique.set(key, item);
  }
  return [...unique.values()];
}

/**
 * Collect the consulted-source surface from canonical source parts and
 * completed tool outputs only. Assistant-authored prose and marker comments
 * are deliberately excluded: model text is not a provenance record.
 */
export function collectConsultedArtifacts(
  messages: readonly UIMessage[],
): ConsultedArtifacts {
  const media = emptyMedia();
  const documents: DocumentAction[] = [];

  for (const message of messages) {
    if (message.role !== "assistant") continue;
    const parts = convexToUIParts(message);

    for (const sourcePart of parts.sources) {
      if (sourcePart.type !== "source-url") continue;
      const url = String(sourcePart.url ?? "").trim();
      if (!url) continue;
      media.webSources.push({
        title: sourcePart.title?.trim() || url,
        url,
      });
    }

    for (const toolPart of parts.toolParts) {
      if (toolPart.state !== "output-available") continue;
      const text = outputText(toolPart.output);
      mergeMedia(media, extractMediaFromText(text));
      media.webSources.push(...structuredSources(toolPart.output));
      documents.push(...extractDocumentActionsFromToolOutput(toolPart.output));
    }
  }

  return {
    media: {
      youtubeVideos: dedupe(
        media.youtubeVideos,
        (video) => video.url || video.videoId,
      ),
      secDocuments: dedupe(
        media.secDocuments,
        (document) => document.accessionNumber || document.documentUrl,
      ),
      webSources: dedupe(
        media.webSources,
        (source) => source.url || source.title,
      ),
      profiles: dedupe(
        media.profiles,
        (profile) => profile.url || profile.name,
      ),
      images: dedupe(media.images, (image) => image.url),
    },
    documents: dedupe(documents, (document) => document.documentId),
  };
}
