/**
 * nb_claim — claim block with expand/collapse + evidence list.
 *
 * Kit parity: Notebook.jsx lines 195-228, notebook.css .nb-claim*.
 */
import { useState } from "react";
import {
  Node,
  mergeAttributes,
  NodeViewWrapper,
  ReactNodeViewRenderer,
} from "@tiptap/react";
import { Target, CheckCircle2, AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";

export type ClaimEvidence = {
  n: number;
  label: string;
  kind: "support" | "conflict";
};

export type ClaimAttrs = {
  statement: string;
  support: number;
  conflict: number;
  evidence: ClaimEvidence[];
  open: boolean;
};

function parseClaimPayload(element: HTMLElement): Partial<ClaimAttrs> {
  const raw = element.getAttribute("data-claim");
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Partial<ClaimAttrs>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function parseNumberAttr(element: HTMLElement, name: string, fallback: number) {
  const value = Number(element.getAttribute(name));
  return Number.isFinite(value) ? value : fallback;
}

function parseEvidenceAttr(element: HTMLElement, fallback: ClaimEvidence[]) {
  const raw = element.getAttribute("data-evidence");
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as ClaimEvidence[];
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function ClaimNodeView(props: {
  node: { attrs: ClaimAttrs };
  updateAttributes: (attrs: Partial<ClaimAttrs>) => void;
}) {
  const { statement, support, conflict, evidence, open: initialOpen } =
    props.node.attrs;
  const [localOpen, setLocalOpen] = useState<boolean>(initialOpen !== false);

  const toggle = () => {
    const next = !localOpen;
    setLocalOpen(next);
    props.updateAttributes({ open: next });
  };

  return (
    <NodeViewWrapper as="div" className="nb-claim" data-type="nb-claim">
      <div
        className="nb-claim-head"
        onClick={toggle}
        role="button"
        tabIndex={0}
        aria-expanded={localOpen}
        aria-controls="nb-claim-evidence"
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle();
          }
        }}
        style={{ cursor: "pointer" }}
      >
        <Target className="h-3 w-3" aria-hidden="true" />
        <span
          className="kicker"
          style={{ color: "var(--accent-ink, #ad5f45)" }}
        >
          Claim
        </span>
        <span className="nb-claim-status">
          <span className="pill pill-ok" style={{ fontSize: 10 }}>
            <CheckCircle2 className="inline h-2.5 w-2.5 mr-1" aria-hidden="true" />
            {support} support
          </span>
          <span className="pill pill-warn" style={{ fontSize: 10 }}>
            <AlertTriangle className="inline h-2.5 w-2.5 mr-1" aria-hidden="true" />
            {conflict} conflict
          </span>
        </span>
        <span style={{ marginLeft: 8, fontSize: 10.5 }}>
          {localOpen ? (
            <ChevronDown className="h-3 w-3 inline" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-3 w-3 inline" aria-hidden="true" />
          )}
        </span>
      </div>
      <div className="nb-claim-body">{statement}</div>
      {localOpen && evidence.length > 0 && (
        <div className="nb-claim-evidence" id="nb-claim-evidence">
          {evidence.map((ev, i) => (
            <div
              key={`${ev.n}-${i}`}
              className="nb-claim-ev"
              data-kind={ev.kind}
            >
              <span className="cite" style={{ pointerEvents: "none" }}>
                {ev.n}
              </span>
              <span>{ev.label}</span>
            </div>
          ))}
        </div>
      )}
    </NodeViewWrapper>
  );
}

export const NbClaim = Node.create({
  name: "nbClaim",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      statement: {
        default: "",
        parseHTML: (element) =>
          parseClaimPayload(element as HTMLElement).statement ??
          element.getAttribute("data-statement") ??
          element.getAttribute("statement") ??
          "",
        renderHTML: (attrs) => ({ "data-statement": attrs.statement }),
      },
      support: {
        default: 0,
        parseHTML: (element) =>
          parseClaimPayload(element as HTMLElement).support ??
          parseNumberAttr(element as HTMLElement, "data-support", 0),
        renderHTML: (attrs) => ({ "data-support": attrs.support }),
      },
      conflict: {
        default: 0,
        parseHTML: (element) =>
          parseClaimPayload(element as HTMLElement).conflict ??
          parseNumberAttr(element as HTMLElement, "data-conflict", 0),
        renderHTML: (attrs) => ({ "data-conflict": attrs.conflict }),
      },
      evidence: {
        default: [] as ClaimEvidence[],
        parseHTML: (element) =>
          parseClaimPayload(element as HTMLElement).evidence ??
          parseEvidenceAttr(element as HTMLElement, []),
        renderHTML: (attrs) => ({ "data-evidence": JSON.stringify(attrs.evidence ?? []) }),
      },
      open: {
        default: true,
        parseHTML: (element) => {
          const payloadOpen = parseClaimPayload(element as HTMLElement).open;
          if (typeof payloadOpen === "boolean") return payloadOpen;
          return element.getAttribute("data-open") !== "false";
        },
        renderHTML: (attrs) => ({ "data-open": attrs.open === false ? "false" : "true" }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="nb-claim"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "nb-claim" }),
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ClaimNodeView);
  },
});
