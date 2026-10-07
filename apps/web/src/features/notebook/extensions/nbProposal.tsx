/**
 * nb_proposal — inline AI proposal with accept/dismiss.
 *
 * Kit parity: Notebook.jsx lines 126-152 & 230-250 (inline replacement with strikethrough),
 * lines 327-345 (ProposalCard).
 *
 * Rendered as a block-level node containing both the original text (superseded
 * when accepted) and the proposed replacement, plus an aside card with actions.
 */
import {
  Node,
  mergeAttributes,
  NodeViewWrapper,
  ReactNodeViewRenderer,
} from "@tiptap/react";
import { Sparkles } from "lucide-react";

type ProposalState = "pending" | "accepted" | "dismissed";

export type ProposalAttrs = {
  id: string;
  label: string;
  note: string;
  originalText: string;
  proposedText: string;
  state: ProposalState;
};

function ProposalNodeView(props: {
  node: { attrs: ProposalAttrs };
  updateAttributes: (attrs: Partial<ProposalAttrs>) => void;
}) {
  const { id, label, note, originalText, proposedText, state } = props.node.attrs;

  if (state === "dismissed") {
    return <NodeViewWrapper style={{ display: "none" }} />;
  }

  const accepted = state === "accepted";

  return (
    <NodeViewWrapper
      as="div"
      className="nb-proposal-line"
      data-accepted={accepted ? "true" : "false"}
      data-proposal-id={id}
    >
      <p className="nb-p">
        {accepted ? (
          <span className="nb-proposal-ink">{proposedText}</span>
        ) : (
          <>
            <span className="nb-strike">{originalText}</span>{" "}
            <span className="nb-proposal-hl">{proposedText}</span>
          </>
        )}
      </p>
      <aside
        className="nb-proposal-card"
        data-state={accepted ? "accepted" : "pending"}
      >
        <div className="nb-proposal-head">
          <Sparkles className="h-3 w-3" aria-hidden="true" />
          <span
            className="kicker"
            style={{
              color: accepted ? "var(--success, #059669)" : "var(--accent-ink, #ad5f45)",
            }}
          >
            {accepted ? "applied" : label}
          </span>
        </div>
        <div className="nb-proposal-note">{note}</div>
        {!accepted && (
          <div className="nb-proposal-actions">
            <button
              type="button"
              className="nb-proposal-btn nb-proposal-btn--accept"
              aria-label={`Accept proposal: ${label}`}
              onClick={() => props.updateAttributes({ state: "accepted" })}
            >
              Accept
            </button>
            <button
              type="button"
              className="nb-proposal-btn"
              aria-label={`Dismiss proposal: ${label}`}
              onClick={() => props.updateAttributes({ state: "dismissed" })}
            >
              Dismiss
            </button>
          </div>
        )}
      </aside>
    </NodeViewWrapper>
  );
}

export const NbProposal = Node.create({
  name: "nbProposal",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      id: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-id") ?? element.getAttribute("id") ?? "",
        renderHTML: (attrs) => ({ "data-id": attrs.id }),
      },
      label: {
        default: "AI proposal",
        parseHTML: (element) => element.getAttribute("data-label") ?? element.getAttribute("label") ?? "AI proposal",
        renderHTML: (attrs) => ({ "data-label": attrs.label }),
      },
      note: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-note") ?? element.getAttribute("note") ?? "",
        renderHTML: (attrs) => ({ "data-note": attrs.note }),
      },
      originalText: {
        default: "",
        parseHTML: (element) =>
          element.getAttribute("data-original-text") ?? element.getAttribute("originalText") ?? "",
        renderHTML: (attrs) => ({ "data-original-text": attrs.originalText }),
      },
      proposedText: {
        default: "",
        parseHTML: (element) =>
          element.getAttribute("data-proposed-text") ?? element.getAttribute("proposedText") ?? "",
        renderHTML: (attrs) => ({ "data-proposed-text": attrs.proposedText }),
      },
      state: {
        default: "pending",
        parseHTML: (element) => {
          const state = element.getAttribute("data-state") ?? element.getAttribute("state");
          return state === "accepted" || state === "dismissed" ? state : "pending";
        },
        renderHTML: (attrs) => ({ "data-state": attrs.state }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="nb-proposal"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "nb-proposal" }),
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ProposalNodeView);
  },
});
