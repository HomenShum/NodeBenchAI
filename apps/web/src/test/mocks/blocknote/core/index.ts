export type PartialBlock = Record<string, unknown>;

export const BlockNoteEditor = {
  create: () => ({
    tryParseMarkdownToBlocks: async () => [] as PartialBlock[],
  }),
};
