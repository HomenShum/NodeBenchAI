import { describe, expect, it } from "vitest";

import { getViewportClass } from "./routeTiming";

describe("getViewportClass", () => {
  it("classifies mobile, tablet, and desktop widths", () => {
    expect(getViewportClass(390)).toBe("mobile");
    expect(getViewportClass(900)).toBe("tablet");
    expect(getViewportClass(1440)).toBe("desktop");
  });
});
