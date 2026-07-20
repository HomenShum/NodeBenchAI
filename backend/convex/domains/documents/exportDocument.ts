import { v } from "convex/values";
import { query } from "../../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { Doc } from "../../_generated/dataModel";

/**
 * Serialize ProseMirror/BlockNote JSON to Markdown.
 *
 * Handles: headings, paragraphs, bullet/numbered/check lists,
 * code blocks, blockquotes, bold/italic/code inline marks.
 */

function inlineToMarkdown(nodes: any[]): string {
  if (!Array.isArray(nodes)) return "";
  return nodes
    .map((node) => {
      if (node.type === "text") {
        let text = node.text || "";
        const marks: any[] = Array.isArray(node.marks) ? node.marks : [];
        const styles = node.styles || {};
        if (marks.some((m: any) => m.type === "bold") || styles.bold)
          text = `**${text}**`;
        if (marks.some((m: any) => m.type === "italic") || styles.italic)
          text = `*${text}*`;
        if (marks.some((m: any) => m.type === "code") || styles.code)
          text = `\`${text}\``;
        return text;
      }
      // Nested blocks (e.g. inline content inside containers)
      if (node.content) return inlineToMarkdown(node.content);
      return "";
    })
    .join("");
}

function blockToMarkdown(block: any, depth: number = 0): string {
  if (!block || typeof block !== "object") return "";

  const type = block.type;
  const content: any[] = Array.isArray(block.content) ? block.content : [];
  const props = block.props || block.attrs || {};

  switch (type) {
    case "doc":
      return content.map((c) => blockToMarkdown(c, depth)).join("\n\n");

    case "blockContainer":
    case "blockGroup":
      return content.map((c) => blockToMarkdown(c, depth)).join("\n");

    case "paragraph":
      return inlineToMarkdown(content);

    case "heading": {
      const level = props.level || 1;
      return "#".repeat(Math.min(level, 6)) + " " + inlineToMarkdown(content);
    }

    case "bulletListItem":
      return "  ".repeat(depth) + "- " + inlineToMarkdown(content);

    case "numberedListItem":
      return "  ".repeat(depth) + "1. " + inlineToMarkdown(content);

    case "checkListItem": {
      const checked = props.checked || block.checked || false;
      return (
        "  ".repeat(depth) +
        `- [${checked ? "x" : " "}] ` +
        inlineToMarkdown(content)
      );
    }

    case "codeBlock": {
      const lang = props.language || "";
      const code = content.map((n: any) => n.text || "").join("");
      return "```" + lang + "\n" + code + "\n```";
    }

    case "quote":
    case "blockquote":
      return "> " + inlineToMarkdown(content);

    case "horizontalRule":
      return "---";

    case "image": {
      const url = props.url || props.src || "";
      const alt = props.alt || props.caption || "";
      return `![${alt}](${url})`;
    }

    case "table": {
      // Simplified table rendering
      const rows = content.filter((c: any) => c.type === "tableRow");
      if (rows.length === 0) return "";
      const lines: string[] = [];
      rows.forEach((row: any, i: number) => {
        const cells = (row.content || []).map(
          (cell: any) => inlineToMarkdown(cell.content || [])
        );
        lines.push("| " + cells.join(" | ") + " |");
        if (i === 0) {
          lines.push("| " + cells.map(() => "---").join(" | ") + " |");
        }
      });
      return lines.join("\n");
    }

    default:
      // Unknown block: try to extract inline text
      if (content.length > 0) {
        return content.map((c) => blockToMarkdown(c, depth)).join("\n");
      }
      return "";
  }
}

function proseMirrorToMarkdown(content: string): string {
  if (!content) return "";
  try {
    const parsed = JSON.parse(content);
    return blockToMarkdown(parsed);
  } catch {
    // Not valid JSON — return as-is (may be plain text)
    return content;
  }
}

export const exportToMarkdown = query({
  args: {
    documentId: v.id("documents"),
  },
  handler: async (ctx, { documentId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const doc = (await ctx.db.get(documentId)) as Doc<"documents"> | null;
    if (!doc) throw new Error("Document not found");
    if (!doc.isPublic && doc.createdBy !== userId)
      throw new Error("Unauthorized");

    const markdown = proseMirrorToMarkdown(doc.content || "");

    return {
      title: doc.title,
      markdown: `# ${doc.title}\n\n${markdown}`,
    };
  },
});
