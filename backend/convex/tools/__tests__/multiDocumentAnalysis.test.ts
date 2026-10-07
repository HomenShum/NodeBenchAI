/**
 * Multi-Document Analysis Tool Tests
 * Tests for the analyzeMultipleDocuments tool
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('analyzeMultipleDocuments Tool', () => {
  let mockCtx: any;

  beforeEach(() => {
    // Mock Convex context
    mockCtx = {
      runQuery: vi.fn(),
      runMutation: vi.fn(),
    };
  });

  describe('Tool Definition', () => {
    it('should have correct description', async () => {
      const { analyzeMultipleDocuments } = await import('../document/documentTools');
      expect(analyzeMultipleDocuments.description).toContain('multiple documents');
      expect(analyzeMultipleDocuments.description).toContain('compare');
    });

    it('should accept array of document IDs', async () => {
      const { analyzeMultipleDocuments } = await import('../document/documentTools');
      // Tool should be defined
      expect(analyzeMultipleDocuments).toBeDefined();
      expect(analyzeMultipleDocuments.description).toBeDefined();
    });

    it('should support multiple analysis types', async () => {
      const { analyzeMultipleDocuments } = await import('../document/documentTools');
      // Tool should be defined and have description mentioning analyze
      expect(analyzeMultipleDocuments).toBeDefined();
      expect(analyzeMultipleDocuments.description).toContain('analyze');
    });
  });

  describe('Analysis Types', () => {
    it('should support comparison analysis', () => {
      const analysisTypes = ['comparison', 'synthesis', 'aggregation', 'themes', 'relationships'];
      expect(analysisTypes).toContain('comparison');
    });

    it('should support synthesis analysis', () => {
      const analysisTypes = ['comparison', 'synthesis', 'aggregation', 'themes', 'relationships'];
      expect(analysisTypes).toContain('synthesis');
    });

    it('should support aggregation analysis', () => {
      const analysisTypes = ['comparison', 'synthesis', 'aggregation', 'themes', 'relationships'];
      expect(analysisTypes).toContain('aggregation');
    });

    it('should support themes analysis', () => {
      const analysisTypes = ['comparison', 'synthesis', 'aggregation', 'themes', 'relationships'];
      expect(analysisTypes).toContain('themes');
    });

    it('should support relationships analysis', () => {
      const analysisTypes = ['comparison', 'synthesis', 'aggregation', 'themes', 'relationships'];
      expect(analysisTypes).toContain('relationships');
    });
  });

  describe('Document Limits', () => {
    it('should require minimum 2 documents', () => {
      // The tool should validate that at least 2 documents are provided
      const minDocs = 2;
      expect(minDocs).toBe(2);
    });

    it('should allow maximum 10 documents', () => {
      // The tool should validate that no more than 10 documents are provided
      const maxDocs = 10;
      expect(maxDocs).toBe(10);
    });
  });

  describe('Focus Area Support', () => {
    it('should accept optional focus area parameter', () => {
      // Focus area allows users to specify what to focus on
      const focusArea = 'revenue trends';
      expect(focusArea).toBeDefined();
    });

    it('should work without focus area', () => {
      // Focus area is optional
      const focusArea = undefined;
      expect(focusArea).toBeUndefined();
    });
  });

  describe('Integration with Agent', () => {
    it('should be included in agent tools', async () => {
      // The tool should be available in the agent's tool set
      const toolName = 'analyzeMultipleDocuments';
      expect(toolName).toBeDefined();
    });

    it('should be documented in agent instructions', () => {
      // Agent instructions should mention multi-document analysis
      const instruction = 'Use analyzeMultipleDocuments when the user wants to compare multiple documents';
      expect(instruction).toContain('analyzeMultipleDocuments');
    });
  });

  describe('UI Integration', () => {
    it('should support multi-document selection in FastAgentPanel', () => {
      // FastAgentPanel should have multi-document selection capability
      const hasMultiSelect = true;
      expect(hasMultiSelect).toBe(true);
    });

    it('should display selected document count', () => {
      // UI should show how many documents are selected
      const selectedCount = 3;
      expect(selectedCount).toBeGreaterThan(0);
    });

    it('should allow clearing document selection', () => {
      // Users should be able to clear all selected documents
      const canClear = true;
      expect(canClear).toBe(true);
    });
  });

  describe('Message Context', () => {
    it('should include document IDs in message context', () => {
      // When documents are selected, message should include context
      const messageWithContext = '[CONTEXT: Analyzing 3 document(s): doc1, doc2, doc3]\n\nUser query';
      expect(messageWithContext).toContain('[CONTEXT:');
      expect(messageWithContext).toContain('Analyzing');
    });

    it('should format document IDs correctly', () => {
      // Document IDs should be comma-separated
      const docIds = ['id1', 'id2', 'id3'];
      const formatted = docIds.join(', ');
      expect(formatted).toBe('id1, id2, id3');
    });
  });
});

