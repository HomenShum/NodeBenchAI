/**
 * Shared detection for machine-formatted answer bodies (JSON / Markdown
 * table) produced by the json/table response shapes in
 * convex/domains/redesign/chatRuns.ts. Both the live ChatSurface and the
 * reproducible replay page consult this so the two renderers cannot disagree
 * about when an answer needs monospace block treatment instead of prose.
 */
export function isStructuredAnswer(text: string): boolean {
  const trimmed = text.trimStart();
  if (/^[[{]/.test(trimmed)) return true;
  const pipeLines = text
    .split("\n")
    .filter((line) => /^\s*\|.*\|\s*$/.test(line));
  return pipeLines.length >= 2;
}
