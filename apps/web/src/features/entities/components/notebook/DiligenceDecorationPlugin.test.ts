/**
 * Tests for DiligenceDecorationPlugin — the ProseMirror Plugin + DecorationSet
 * runtime that makes live diligence appear as overlay widgets instead of
 * seeded document blocks.
 *
 * Scenario: The orchestrator runtime emits a structured diligence projection
 *           for a block. The hook updates a shared ref that the plugin's
 *           getDecorations callback reads; on the next meta-tagged
 *           transaction the plugin rebuilds its DecorationSet.
 *
 * API under test:
 *   - diligenceDecorationPluginKey (exported key)
 *   - createDiligenceDecorationPlugin(config)
 *   - The plugin respects meta-triggers for rebuild
 *   - Block-specific renderers in config.renderers get called; missing
 *     renderers fall back to the default renderer
 *   - Empty decorations produce an empty DecorationSet
 */

import { describe, it, expect, vi } from "vitest";
import { EditorState } from "prosemirror-state";
import { Schema, type DOMOutputSpec } from "prosemirror-model";
import { DecorationSet } from "prosemirror-view";
import {
  createDiligenceDecorationPlugin,
  diligenceDecorationPluginKey,
  type DiligenceDecorationData,
  type DecorationRenderer,
} from "./DiligenceDecorationPlugin";

/**
 * Minimal schema — doc + paragraph + heading + text. Enough to exercise the
 * plugin's anchor resolution without spinning up a full Tiptap editor.
 */
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      group: "block",
      content: "inline*",
      toDOM(): DOMOutputSpec {
        return ["p", 0];
      },
    },
    heading: {
      group: "block",
      content: "inline*",
      attrs: { level: { default: 1 } },
      toDOM(node): DOMOutputSpec {
        return [`h${node.attrs.level}`, 0];
      },
    },
    text: { group: "inline" },
  },
});

function text(s: string) {
  return schema.text(s);
}

function doc(...blocks: unknown[]) {
  return schema.nodes.doc.create(null, blocks as never);
}

function heading(s: string, level = 2) {
  return schema.nodes.heading.create({ level }, text(s));
}

function para(s: string) {
  return schema.nodes.paragraph.create(null, text(s));
}

function makeFounder(
  overrides: Partial<DiligenceDecorationData> = {},
): DiligenceDecorationData {
  return {
    blockType: "founder",
    overallTier: "verified",
    headerText: "Founders",
    scratchpadRunId: "run_001",
    version: 1,
    updatedAt: Date.now(),
    ...overrides,
  };
}

const stubRenderer: DecorationRenderer = {
  render: (data) => {
    const node = document.createElement("div");
    node.className = "stub-renderer";
    node.dataset.block = data.blockType;
    node.dataset.version = String(data.version);
    node.textContent = data.headerText;
    return node;
  },
};

function pluginState(state: EditorState): DecorationSet {
  return diligenceDecorationPluginKey.getState(state) ?? DecorationSet.empty;
}

describe("createDiligenceDecorationPlugin", () => {
  it("exports a stable PluginKey (diligenceDecorationPluginKey)", () => {
    expect(diligenceDecorationPluginKey).toBeDefined();
    // PluginKey is callable via getState in PM state module
    expect(typeof diligenceDecorationPluginKey.getState).toBe("function");
  });

  it("initializes with an empty DecorationSet when getDecorations returns []", () => {
    const plugin = createDiligenceDecorationPlugin({
      getDecorations: () => [],
      anchors: [{ kind: "top" }],
      renderers: { founder: stubRenderer },
    });
    const state = EditorState.create({
      doc: doc(para("body")),
      plugins: [plugin],
    });
    expect(pluginState(state).find().length).toBe(0);
  });

  it("builds a decoration set when getDecorations returns data at init", () => {
    const plugin = createDiligenceDecorationPlugin({
      getDecorations: () => [makeFounder()],
      anchors: [{ kind: "top" }],
      renderers: { founder: stubRenderer },
    });
    const state = EditorState.create({
      doc: doc(para("body")),
      plugins: [plugin],
    });
    // Even though the plugin packs all decorations into one widget, find()
    // returns the widget(s) that carry decorations.
    expect(pluginState(state).find().length).toBeGreaterThan(0);
  });

  it("rebuilds the set when a meta-tagged transaction fires", () => {
    let currentDecorations: DiligenceDecorationData[] = [];
    const plugin = createDiligenceDecorationPlugin({
      getDecorations: () => currentDecorations,
      anchors: [{ kind: "top" }],
      renderers: { founder: stubRenderer },
    });
    let state = EditorState.create({
      doc: doc(para("body")),
      plugins: [plugin],
    });

    // No decorations initially
    expect(pluginState(state).find().length).toBe(0);

    // Mutate the source-of-truth and dispatch a meta-tagged transaction.
    currentDecorations = [makeFounder()];
    const tr = state.tr.setMeta(diligenceDecorationPluginKey, true);
    state = state.apply(tr);

    // Now the plugin re-read getDecorations and built a widget.
    expect(pluginState(state).find().length).toBeGreaterThan(0);
  });

  it("skipping the meta trigger leaves the set unchanged across doc-static transactions", () => {
    let currentDecorations: DiligenceDecorationData[] = [makeFounder()];
    const plugin = createDiligenceDecorationPlugin({
      getDecorations: () => currentDecorations,
      anchors: [{ kind: "top" }],
      renderers: { founder: stubRenderer },
    });
    let state = EditorState.create({
      doc: doc(para("body")),
      plugins: [plugin],
    });
    const originalCount = pluginState(state).find().length;
    expect(originalCount).toBeGreaterThan(0);

    // Mutate the data but DON'T dispatch a meta — plugin should still show
    // the prior decorations (stale data is preferable to a surprise rebuild).
    currentDecorations = [];
    const tr = state.tr; // empty tr; no doc change, no meta
    state = state.apply(tr);
    expect(pluginState(state).find().length).toBe(originalCount);
  });

  it("uses registered renderer for its block type", () => {
    const renderFn = vi.fn(stubRenderer.render);
    const plugin = createDiligenceDecorationPlugin({
      getDecorations: () => [makeFounder()],
      anchors: [{ kind: "top" }],
      renderers: { founder: { render: renderFn } },
    });
    const state = EditorState.create({
      doc: doc(para("body")),
      plugins: [plugin],
    });
    const set = pluginState(state);
    // The widget spec is lazy: ask the spec to realize its DOM to invoke render
    const widgets = set.find();
    expect(widgets.length).toBeGreaterThan(0);
    const spec = widgets[0].spec as { toDOM?: () => HTMLElement; key?: string };
    // Some PM builds expose toDOM on the spec; if not, we can read the widget
    // via the decoration's own `.type` field. Either way, exercise any
    // available lazy realization to count renderer invocations.
    if (typeof spec.toDOM === "function") {
      spec.toDOM();
    } else {
      // Fallback: realize via the decoration's internal widget type
      const widget = widgets[0] as unknown as {
        type: { toDOM?: (view: unknown, pos: number) => HTMLElement };
      };
      if (widget.type?.toDOM) widget.type.toDOM({} as unknown, 0);
    }
    expect(renderFn).toHaveBeenCalled();
  });

  it("attaches accept and dismiss callbacks to custom renderer action buttons", () => {
    const onAcceptDecoration = vi.fn();
    const onDismissDecoration = vi.fn();
    const plugin = createDiligenceDecorationPlugin({
      getDecorations: () => [makeFounder()],
      anchors: [{ kind: "top" }],
      renderers: {
        founder: {
          render: (data) => {
            const root = document.createElement("div");
            const accept = document.createElement("button");
            accept.type = "button";
            accept.setAttribute("data-action", "accept");
            accept.textContent = "Accept";
            root.appendChild(accept);
            const dismiss = document.createElement("button");
            dismiss.type = "button";
            dismiss.setAttribute("data-action", "dismiss");
            dismiss.textContent = "Dismiss";
            root.appendChild(dismiss);
            root.dataset.block = data.blockType;
            return root;
          },
        },
      },
      onAcceptDecoration,
      onDismissDecoration,
    });
    const state = EditorState.create({
      doc: doc(para("body")),
      plugins: [plugin],
    });
    const widget = pluginState(state).find()[0] as unknown as {
      type?: { toDOM?: (view: unknown, pos: number) => HTMLElement };
    };
    const node = widget.type?.toDOM?.({} as unknown, 0);
    expect(node).toBeTruthy();
    const buttons = node ? Array.from(node.querySelectorAll("button")) : [];
    expect(buttons).toHaveLength(2);

    buttons[0]?.click();
    buttons[1]?.click();

    expect(onAcceptDecoration).toHaveBeenCalledWith("run_001", "founder");
    expect(onDismissDecoration).toHaveBeenCalledWith("run_001", "founder");
  });

  it("empty decorations produce an empty set (fast path)", () => {
    const plugin = createDiligenceDecorationPlugin({
      getDecorations: () => [],
      anchors: [{ kind: "top" }],
      renderers: { founder: stubRenderer },
    });
    const state = EditorState.create({
      doc: doc(para("body")),
      plugins: [plugin],
    });
    expect(pluginState(state)).toBe(DecorationSet.empty);
  });

  it("rebuilds on docChanged even without an explicit meta tag", () => {
    let currentDecorations: DiligenceDecorationData[] = [makeFounder()];
    const getDecorations = vi.fn(() => currentDecorations);
    const plugin = createDiligenceDecorationPlugin({
      getDecorations,
      anchors: [{ kind: "top" }],
      renderers: { founder: stubRenderer },
    });
    let state = EditorState.create({
      doc: doc(para("body")),
      plugins: [plugin],
    });
    const callsAtInit = getDecorations.mock.calls.length;

    // Insert a char at the start — docChanged is true.
    const tr = state.tr.insertText("!", 1);
    state = state.apply(tr);

    // getDecorations should have been called again.
    expect(getDecorations.mock.calls.length).toBeGreaterThan(callsAtInit);
  });
});
