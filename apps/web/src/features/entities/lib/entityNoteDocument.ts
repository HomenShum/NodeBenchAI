export type EntityNoteDocumentBlockType =
  | "paragraph"
  | "heading"
  | "bullet"
  | "quote"
  | "check"
  | "code";

export type EntityNoteDocumentBlock = {
  blockId: string;
  parentBlockId?: string;
  order: number;
  type: EntityNoteDocumentBlockType;
  depth?: number;
  text: string;
  markdown?: string;
  lexical?: unknown;
  entityRefs?: string[];
  sourceRefs?: string[];
};

export type EntityNoteDocumentSnapshot = {
  _id?: string;
  revision: number;
  markdown: string;
  plainText: string;
  createdAt: number;
};

export type EntityNoteDocumentOutlineItem = {
  blockId: string;
  title: string;
  order: number;
  depth?: number;
};

export type EntityNoteDocumentEntityLink = {
  _id?: string;
  blockId?: string;
  entitySlug: string;
  relation: "primary" | "mention";
  entityName?: string;
  entityType?: string;
  createdAt: number;
};

export type EntityNoteDocumentSourceLink = {
  _id?: string;
  blockId?: string;
  evidenceId: string;
  label: string;
  type?: string;
  sourceUrl?: string;
  createdAt: number;
};

export type EntityNoteDocumentEvent = {
  _id?: string;
  type: "created" | "edited" | "snapshot" | "imported" | "exported";
  label: string;
  summary?: string;
  createdAt: number;
};

export type EntityNoteDocument = {
  _id?: string;
  title: string;
  markdown: string;
  plainText: string;
  lexicalState?: unknown;
  latestRevision: number;
  updatedAt?: number;
  blocks: EntityNoteDocumentBlock[];
  snapshots?: EntityNoteDocumentSnapshot[];
  outline?: EntityNoteDocumentOutlineItem[];
  entityLinks?: EntityNoteDocumentEntityLink[];
  sourceLinks?: EntityNoteDocumentSourceLink[];
  events?: EntityNoteDocumentEvent[];
};

export type LegacyEntityNoteBlock = {
  id: string;
  kind: "observation" | "insight" | "question" | "action";
  title: string;
  body: string;
};

export type LegacyEntityNote = {
  content?: string | null;
  blocks?: LegacyEntityNoteBlock[];
} | null;

function createDefaultMarkdown(entityName?: string) {
  if (entityName?.trim()) {
    return `## ${entityName}\n\nCapture working notes, follow-up questions, and linked ideas here. Use [[Entity Name]] to create cross-memory references.`;
  }
  return "Capture working notes, follow-up questions, and linked ideas here. Use [[Entity Name]] to create cross-memory references.";
}

export function createEmptyEntityNoteDocument(entityName?: string): EntityNoteDocument {
  const markdown = createDefaultMarkdown(entityName);
  return {
    title: entityName ? `${entityName} notebook` : "Entity notebook",
    markdown,
    plainText: markdown.replace(/[#*\[\]]/g, "").trim(),
    latestRevision: 0,
    blocks: [],
    snapshots: [],
    outline: [],
    entityLinks: [],
    sourceLinks: [],
    events: [],
  };
}

function legacyBlocksToMarkdown(blocks: LegacyEntityNoteBlock[]) {
  return blocks
    .flatMap((block) => {
      const next: string[] = [];
      if (block.title?.trim()) next.push(`## ${block.title.trim()}`);
      if (block.body?.trim()) next.push(block.body.trim());
      return next;
    })
    .join("\n\n")
    .trim();
}

export function buildEntityNoteDocumentDraft(
  entityName: string,
  noteDocument?: EntityNoteDocument | null,
  legacyNote?: LegacyEntityNote,
): EntityNoteDocument {
  if (noteDocument) {
    return {
      ...noteDocument,
      title: noteDocument.title || `${entityName} notebook`,
      markdown: noteDocument.markdown || createDefaultMarkdown(entityName),
      plainText: noteDocument.plainText || "",
      blocks: noteDocument.blocks ?? [],
      snapshots: noteDocument.snapshots ?? [],
      outline: noteDocument.outline ?? [],
      entityLinks: noteDocument.entityLinks ?? [],
      sourceLinks: noteDocument.sourceLinks ?? [],
      events: noteDocument.events ?? [],
    };
  }

  const legacyBlocks = Array.isArray(legacyNote?.blocks) ? legacyNote.blocks : [];
  const markdown =
    legacyBlocks.length > 0
      ? legacyBlocksToMarkdown(legacyBlocks)
      : legacyNote?.content?.trim() || createDefaultMarkdown(entityName);

  return {
    title: `${entityName} notebook`,
    markdown,
    plainText: (legacyNote?.content || markdown).replace(/[#*\[\]]/g, "").trim(),
    latestRevision: 0,
    blocks: [],
    snapshots: [],
    outline: [],
    entityLinks: [],
    sourceLinks: [],
    events: [],
  };
}
