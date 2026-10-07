/**
 * Unit tests for documentHelpers utility functions
 */

import { describe, it, expect } from "vitest";
import { normalizeDocument } from "../documentHelpers";

describe("documentHelpers", () => {
  describe("normalizeDocument", () => {
    it("should normalize a basic text document", () => {
      const input = {
        _id: "doc123",
        title: "My Document",
        contentPreview: "This is a preview",
        documentType: "text",
        _creationTime: 1234567890,
        createdBy: "user123",
        isArchived: false,
        isFavorite: false,
      };

      const result = normalizeDocument(input);

      expect(result).toEqual({
        _id: "doc123",
        title: "My Document",
        contentPreview: "This is a preview",
        documentType: "text",
        fileType: undefined,
        fileName: undefined,
        fileId: undefined,
        lastModified: undefined,
        createdAt: 1234567890,
        createdBy: "user123",
        isArchived: false,
        isFavorite: false,
        coverImage: undefined,
        icon: undefined,
      });
    });

    it("should normalize a file document", () => {
      const input = {
        _id: "doc456",
        title: "report.pdf",
        contentPreview: null,
        documentType: "file",
        fileType: "pdf",
        fileName: "report.pdf",
        fileId: "file789",
        lastModified: 9876543210,
        _creationTime: 1234567890,
        createdBy: "user456",
        isArchived: false,
        isFavorite: true,
      };

      const result = normalizeDocument(input);

      expect(result).toEqual({
        _id: "doc456",
        title: "report.pdf",
        contentPreview: null,
        documentType: "file",
        fileType: "pdf",
        fileName: "report.pdf",
        fileId: "file789",
        lastModified: 9876543210,
        createdAt: 1234567890,
        createdBy: "user456",
        isArchived: false,
        isFavorite: true,
        coverImage: undefined,
        icon: undefined,
      });
    });

    it("should normalize a timeline document", () => {
      const input = {
        _id: "doc789",
        title: "Project Timeline",
        contentPreview: "Timeline preview",
        documentType: "timeline",
        _creationTime: 1234567890,
        createdBy: "user789",
        isArchived: false,
        isFavorite: false,
      };

      const result = normalizeDocument(input);

      expect(result.documentType).toBe("timeline");
    });

    it("should handle missing title with default", () => {
      const input = {
        _id: "doc999",
        _creationTime: 1234567890,
        createdBy: "user999",
      };

      const result = normalizeDocument(input);

      expect(result.title).toBe("Untitled");
    });

    it("should handle null contentPreview", () => {
      const input = {
        _id: "doc111",
        title: "Test",
        contentPreview: null,
        _creationTime: 1234567890,
        createdBy: "user111",
      };

      const result = normalizeDocument(input);

      expect(result.contentPreview).toBeNull();
    });

    it("should infer file type from fileId", () => {
      const input = {
        _id: "doc222",
        title: "Test",
        fileId: "file123",
        _creationTime: 1234567890,
        createdBy: "user222",
      };

      const result = normalizeDocument(input);

      expect(result.documentType).toBe("file");
    });

    it("should handle archived documents", () => {
      const input = {
        _id: "doc333",
        title: "Archived Doc",
        isArchived: true,
        _creationTime: 1234567890,
        createdBy: "user333",
      };

      const result = normalizeDocument(input);

      expect(result.isArchived).toBe(true);
    });

    it("should handle favorite documents", () => {
      const input = {
        _id: "doc444",
        title: "Favorite Doc",
        isFavorite: true,
        _creationTime: 1234567890,
        createdBy: "user444",
      };

      const result = normalizeDocument(input);

      expect(result.isFavorite).toBe(true);
    });

    it("should handle cover image", () => {
      const input = {
        _id: "doc555",
        title: "Doc with Cover",
        coverImage: "storage123",
        _creationTime: 1234567890,
        createdBy: "user555",
      };

      const result = normalizeDocument(input);

      expect(result.coverImage).toBe("storage123");
    });

    it("should handle icon", () => {
      const input = {
        _id: "doc666",
        title: "Doc with Icon",
        icon: "📄",
        _creationTime: 1234567890,
        createdBy: "user666",
      };

      const result = normalizeDocument(input);

      expect(result.icon).toBe("📄");
    });

    it("should handle missing _creationTime with default 0", () => {
      const input = {
        _id: "doc777",
        title: "Test",
        createdBy: "user777",
      };

      const result = normalizeDocument(input);

      expect(result.createdAt).toBe(0);
    });
  });
});

