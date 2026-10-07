import "@testing-library/jest-dom";
import { vi } from "vitest";

vi.mock("@/components/UnifiedEditor", () => ({
  __esModule: true,
  default: () => null,
}));

if (typeof window !== "undefined" && !window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    }),
  });
}

// jsdom doesn't implement the layout APIs that ProseMirror's
// scrollToSelection / coordsAtPos rely on. Stub them so editor transactions
// don't throw `target.getClientRects is not a function` during keyboard
// input from TipTap-based components.
if (typeof Range !== "undefined") {
  const emptyRectList = {
    length: 0,
    item: () => null,
    [Symbol.iterator]: function* () {},
  } as unknown as DOMRectList;
  const emptyRect = {
    x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0,
    toJSON() { return {}; },
  } as DOMRect;
  if (!Range.prototype.getBoundingClientRect) {
    Range.prototype.getBoundingClientRect = () => emptyRect;
  }
  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = () => emptyRectList;
  }
  if (typeof Element !== "undefined" && !(Element.prototype as any).getClientRects) {
    (Element.prototype as any).getClientRects = () => emptyRectList;
  }
}

// jsdom doesn't implement Document.elementFromPoint, which ProseMirror's
// mousedown / posAtCoords paths invoke. Stub it so click events on the
// editor surface don't crash the test runtime.
if (typeof document !== "undefined" && typeof (document as any).elementFromPoint !== "function") {
  (document as any).elementFromPoint = () => null;
}
