import { describe, expect, it } from "vitest";
import {
  normalizeNumericDisplay,
  sanitizeDocumentTitle,
  sanitizeProfessionalText,
  sanitizeReadableText,
} from "@/lib/displayText";

describe("displayText", () => {
  it("collapses duplicate file extensions", () => {
    expect(sanitizeDocumentTitle("SARI-1993-1100-04.pdf.pdf")).toBe("SARI-1993-1100-04.pdf");
    expect(sanitizeDocumentTitle("brief.md.md")).toBe("brief.md");
  });

  it("normalizes spaced numeric separators", () => {
    expect(normalizeNumericDisplay("35, 259 upvotes")).toBe("35,259 upvotes");
  });

  it("replaces unprofessional slang in readable copy", () => {
    expect(sanitizeProfessionalText("Microslop shipped another patch.")).toBe("Microsoft shipped another patch.");
    expect(sanitizeReadableText("Microslop hit 35, 259 mentions")).toBe("Microsoft hit 35,259 mentions");
  });
});
