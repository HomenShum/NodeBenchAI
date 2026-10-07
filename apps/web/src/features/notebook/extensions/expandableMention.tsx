/**
 * ExpandableMention — Tiptap inline node for entity mentions that expand
 * to show entity intelligence, claims, sources, and backlinks.
 *
 * Pattern: Inline Node with ReactNodeViewRenderer
 * Prior art:
 *   - Roam Research — bidirectional backlinks as graph primitives
 *   - Notion — @mention inline references with hover previews
 *   - Obsidian — backlinks panel, transclusion
 *
 * See: docs/architecture/EXPANDABLE_GRAPH_NOTEBOOK.md
 */
import { useState, useCallback } from "react";
import {
  Node,
  mergeAttributes,
  NodeViewWrapper,
  ReactNodeViewRenderer,
} from "@tiptap/react";
import {
  Building2,
  User,
  ChevronDown,
  ChevronRight,
  Link2,
} from "lucide-react";
import { MentionExpansionPanel } from "../components/MentionExpansionPanel";
import { useBacklinks } from "../hooks/useEntityExpansion";

export type MentionEdge = {
  label: string;
  relation: string;
};

export type MentionClaim = {
  text: string;
  src: string;
};

export type ExpandableMentionAttrs = {
  entityId: string;
  label: string;
  kind: "company" | "person" | "tag";
  expanded: boolean;
};

function ExpandableMentionView(props: {
  node: { attrs: ExpandableMentionAttrs };
  updateAttributes: (attrs: Partial<ExpandableMentionAttrs>) => void;
}) {
  const { entityId, label, kind, expanded: initialExpanded } = props.node.attrs;
  const { updateAttributes } = props;
  const [expanded, setExpanded] = useState(initialExpanded);
  const { backlinks } = useBacklinks(entityId);
  const backlinkCount = backlinks.length;

  const toggle = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      updateAttributes({ expanded: next });
      return next;
    });
  }, [updateAttributes]);

  const Icon = kind === "person" ? User : Building2;

  return (
    <NodeViewWrapper as="span" className="nb-expandable-mention-wrapper">
      <span
        className={`nb-expandable-mention ${expanded ? "expanded" : ""}`}
        data-kind={kind}
        data-entity={entityId}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle();
          }
        }}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={`${label} entity mention${expanded ? ", expanded" : ""}${backlinkCount > 0 ? `, ${backlinkCount} backlinks` : ""}`}
      >
        <Icon className="inline h-3 w-3 mr-0.5 opacity-60" aria-hidden="true" />
        <span>@{label}</span>
        {backlinkCount > 0 && (
          <span className="nb-mention-backlink-badge" title={`${backlinkCount} backlink${backlinkCount !== 1 ? "s" : ""}`}>
            <Link2 className="inline h-2.5 w-2.5" aria-hidden="true" />
            {backlinkCount}
          </span>
        )}
        {expanded ? (
          <ChevronDown className="inline h-3 w-3 ml-0.5 opacity-40" aria-hidden="true" />
        ) : (
          <ChevronRight className="inline h-3 w-3 ml-0.5 opacity-40" aria-hidden="true" />
        )}
      </span>
      {expanded && (
        <MentionExpansionPanel entityId={entityId} label={label} kind={kind} />
      )}
    </NodeViewWrapper>
  );
}

export const ExpandableMention = Node.create({
  name: "expandableMention",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      entityId: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-entity") ?? "",
        renderHTML: (attrs) => ({ "data-entity": attrs.entityId }),
      },
      label: {
        default: "",
        parseHTML: (el) =>
          el.getAttribute("data-label") ??
          el.textContent?.replace(/^@/, "") ??
          "",
        renderHTML: (attrs) => ({ "data-label": attrs.label }),
      },
      kind: {
        default: "company" as const,
        parseHTML: (el) => {
          const raw = el.getAttribute("data-kind");
          if (raw === "company" || raw === "person" || raw === "tag") return raw;
          return "company";
        },
        renderHTML: (attrs) => ({ "data-kind": attrs.kind }),
      },
      expanded: {
        default: false,
        parseHTML: (el) => el.getAttribute("data-expanded") === "true",
        renderHTML: (attrs) => ({
          "data-expanded": attrs.expanded ? "true" : "false",
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="expandable-mention"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { "data-type": "expandable-mention" }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ExpandableMentionView);
  },
});
