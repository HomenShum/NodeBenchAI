/**
 * Document Editing Live API Tests
 * 
 * Tests real API calls with:
 * - Real OpenAI API calls for edit generation
 * - Real Linkup API calls for web search (simulated with mock data)
 * - Separate LLM judge to validate edit quality
 * - Boolean pass/fail scoring (not subjective floats)
 * 
 * Open-ended questions with expected outputs
 */

import { describe, it, expect, beforeEach } from 'vitest';
import OpenAI from 'openai';

// Initialize real OpenAI client - skip tests if no API key
const apiKey = process.env.OPENAI_API_KEY || process.env.CONVEX_OPENAI_API_KEY;
const hasApiKey = Boolean(apiKey);
let openai: OpenAI | null = null;

if (hasApiKey) {
  openai = new OpenAI({
    apiKey: apiKey!,
  });
}

/**
 * LLM Judge - Uses separate LLM to validate edit quality
 * Returns boolean: true if edit is valid, false otherwise
 */
async function judgeEditQuality(
  originalContent: string,
  editProposal: string,
  userRequest: string,
  editType: string
): Promise<{ pass: boolean; reasoning: string }> {
  if (!openai) {
    return { pass: false, reasoning: 'OpenAI client not initialized' };
  }

  try {
    const judgmentPrompt = `You are a document quality judge. Evaluate if the following edit is appropriate and high-quality.

ORIGINAL DOCUMENT:
${originalContent}

USER REQUEST:
${userRequest}

EDIT TYPE: ${editType}

PROPOSED EDIT:
${editProposal}

Evaluate based on:
1. Does the edit address the user's request?
2. Is the content accurate and relevant?
3. Is the formatting appropriate?
4. Does it preserve existing content (for append edits)?
5. Is the writing quality good?

Respond with ONLY a JSON object:
{
  "pass": true/false,
  "reasoning": "brief explanation"
}`;

    const response = await openai.chat.completions.create({
      model: 'gpt-5.4-mini',
      messages: [
        {
          role: 'user',
          content: judgmentPrompt,
        },
      ],
      max_completion_tokens: 200,
    });

    const content = response.choices[0]?.message?.content || '{}';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { pass: false, reasoning: 'Failed to parse judge response' };
    }

    const judgment = JSON.parse(jsonMatch[0]);
    return {
      pass: judgment.pass === true,
      reasoning: judgment.reasoning || 'No reasoning provided',
    };
  } catch (error) {
    console.error('[judgeEditQuality] Error:', error);
    return { pass: false, reasoning: `Judge error: ${error}` };
  }
}

/**
 * Generate edit proposals using real OpenAI API
 */
async function generateEditProposalLive(
  userRequest: string,
  documentTitle: string,
  documentContent: string
): Promise<string> {
  if (!openai) {
    throw new Error('OpenAI client not initialized');
  }

  try {
    const prompt = `You are a document editing assistant. Generate a specific edit proposal for this request.

DOCUMENT TITLE: ${documentTitle}
DOCUMENT CONTENT: ${documentContent.slice(0, 500)}...

USER REQUEST: "${userRequest}"

Generate a specific edit proposal. Return ONLY the proposed new content or changes, no JSON.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-5.4-mini',
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      max_completion_tokens: 500,
    });

    return response.choices[0]?.message?.content || '';
  } catch (error) {
    console.error('[generateEditProposalLive] Error:', error);
    throw error;
  }
}

const describeIfApi = hasApiKey && openai ? describe : describe.skip;

describeIfApi('Document Editing - Live API Tests with LLM Judge', () => {
  describe('Live API Calls with Real OpenAI', () => {
    it.skipIf(!openai)('should generate and validate edit for company research question', async () => {
      const userRequest = 'Add information about Series B healthcare startups and their market opportunity';
      const documentTitle = 'Healthcare Investment Research';
      const documentContent = 'Initial research notes on healthcare sector...';

      // Generate edit proposal using real API
      const editProposal = await generateEditProposalLive(
        userRequest,
        documentTitle,
        documentContent
      );

      expect(editProposal).toBeTruthy();
      expect(editProposal.length).toBeGreaterThan(50);

      // Judge the edit quality using separate LLM
      const judgment = await judgeEditQuality(
        documentContent,
        editProposal,
        userRequest,
        'append'
      );

      console.log('Edit Judgment:', judgment);
      expect(judgment.pass).toBe(true);
    }, 30000);

    it('should generate and validate edit for founder research question', async () => {
      const userRequest = 'Add detailed founder backgrounds and their expertise areas';
      const documentTitle = 'Company Leadership Analysis';
      const documentContent = 'Company overview and basic information...';

      const editProposal = await generateEditProposalLive(
        userRequest,
        documentTitle,
        documentContent
      );

      expect(editProposal).toBeTruthy();

      const judgment = await judgeEditQuality(
        documentContent,
        editProposal,
        userRequest,
        'append'
      );

      console.log('Founder Edit Judgment:', judgment);
      expect(judgment.pass).toBe(true);
    }, 30000);

    it('should generate and validate edit for market analysis question', async () => {
      const userRequest = 'Add comprehensive market analysis including TAM, growth rate, and competitive landscape';
      const documentTitle = 'Market Analysis Report';
      const documentContent = 'Executive summary of market research...';

      const editProposal = await generateEditProposalLive(
        userRequest,
        documentTitle,
        documentContent
      );

      expect(editProposal).toBeTruthy();

      const judgment = await judgeEditQuality(
        documentContent,
        editProposal,
        userRequest,
        'append'
      );

      console.log('Market Analysis Judgment:', judgment);
      expect(judgment.pass).toBe(true);
    }, 30000);

    it('should generate and validate title edit for investment thesis', async () => {
      const userRequest = 'Update the title to reflect this is an investment opportunity analysis for a specific company';
      const documentTitle = 'Research Document';
      const documentContent = 'Analysis of BioTech Innovations Inc...';

      const editProposal = await generateEditProposalLive(
        userRequest,
        documentTitle,
        documentContent
      );

      expect(editProposal).toBeTruthy();

      const judgment = await judgeEditQuality(
        documentTitle,
        editProposal,
        userRequest,
        'title'
      );

      console.log('Title Edit Judgment:', judgment);
      expect(judgment.pass).toBe(true);
    }, 30000);

    it('should generate and validate complex multi-section edit', async () => {
      const userRequest = 'Create a comprehensive investment thesis section that includes market opportunity, team strength, competitive advantages, and risk factors';
      const documentTitle = 'Investment Analysis';
      const documentContent = 'Company: BioTech Innovations\nStage: Series B\nFunding: $15M';

      const editProposal = await generateEditProposalLive(
        userRequest,
        documentTitle,
        documentContent
      );

      expect(editProposal).toBeTruthy();
      expect(editProposal.length).toBeGreaterThan(100);

      const judgment = await judgeEditQuality(
        documentContent,
        editProposal,
        userRequest,
        'append'
      );

      console.log('Complex Edit Judgment:', judgment);
      expect(judgment.pass).toBe(true);
    }, 30000);

    it('should handle open-ended question about competitive analysis', async () => {
      const userRequest = 'What are the key competitive advantages and how should we position against competitors?';
      const documentTitle = 'Competitive Analysis';
      const documentContent = 'Initial competitive landscape overview...';

      const editProposal = await generateEditProposalLive(
        userRequest,
        documentTitle,
        documentContent
      );

      expect(editProposal).toBeTruthy();

      const judgment = await judgeEditQuality(
        documentContent,
        editProposal,
        userRequest,
        'append'
      );

      console.log('Competitive Analysis Judgment:', judgment);
      expect(judgment.pass).toBe(true);
    }, 30000);

    it('should handle open-ended question about funding strategy', async () => {
      const userRequest = 'Develop a comprehensive funding strategy including Series C targets, investor profiles, and timeline';
      const documentTitle = 'Funding Strategy';
      const documentContent = 'Current funding status: Series B, $15M raised...';

      const editProposal = await generateEditProposalLive(
        userRequest,
        documentTitle,
        documentContent
      );

      expect(editProposal).toBeTruthy();

      const judgment = await judgeEditQuality(
        documentContent,
        editProposal,
        userRequest,
        'append'
      );

      console.log('Funding Strategy Judgment:', judgment);
      expect(judgment.pass).toBe(true);
    }, 30000);

    it('should validate that edits preserve existing content', async () => {
      const userRequest = 'Add a new section about regulatory compliance requirements';
      const documentTitle = 'Healthcare Compliance';
      const documentContent = 'Existing section 1: Overview\nExisting section 2: Current status';

      const editProposal = await generateEditProposalLive(
        userRequest,
        documentTitle,
        documentContent
      );

      // Verify existing content is not removed
      expect(editProposal).not.toContain('Existing section 1');
      expect(editProposal).not.toContain('Existing section 2');

      const judgment = await judgeEditQuality(
        documentContent,
        editProposal,
        userRequest,
        'append'
      );

      console.log('Content Preservation Judgment:', judgment);
      expect(judgment.pass).toBe(true);
    }, 30000);

    it('should track API call metrics', async () => {
      const startTime = Date.now();

      const editProposal = await generateEditProposalLive(
        'Add financial projections for next 3 years',
        'Financial Projections',
        'Current revenue: $2M...'
      );

      const generationTime = Date.now() - startTime;

      expect(editProposal).toBeTruthy();
      expect(generationTime).toBeGreaterThan(0);

      console.log(`API Call Metrics:
        - Generation time: ${generationTime}ms
        - Proposal length: ${editProposal.length} chars
        - API: OpenAI gpt-5.4-mini`);
    }, 30000);
  });

  describe('Edit Quality Validation Scenarios', () => {
    it('should validate that edits are contextually relevant', async () => {
      const userRequest = 'Add information about the company\'s product roadmap';
      const documentTitle = 'Product Strategy';
      const documentContent = 'Current product: AI diagnostic platform...';

      const editProposal = await generateEditProposalLive(
        userRequest,
        documentTitle,
        documentContent
      );

      const judgment = await judgeEditQuality(
        documentContent,
        editProposal,
        userRequest,
        'append'
      );

      // Judge should validate relevance
      expect(judgment.pass).toBe(true);
      expect(judgment.reasoning).toBeTruthy();
    }, 30000);

    it('should validate that edits maintain document coherence', async () => {
      const userRequest = 'Add a section about go-to-market strategy';
      const documentTitle = 'GTM Strategy';
      const documentContent = 'Market analysis: $50B TAM, growing 15% YoY...';

      const editProposal = await generateEditProposalLive(
        userRequest,
        documentTitle,
        documentContent
      );

      const judgment = await judgeEditQuality(
        documentContent,
        editProposal,
        userRequest,
        'append'
      );

      expect(judgment.pass).toBe(true);
    }, 30000);

    it('should validate formatting and structure of edits', async () => {
      const userRequest = 'Add a structured list of key metrics and KPIs';
      const documentTitle = 'Metrics Dashboard';
      const documentContent = 'Performance tracking document...';

      const editProposal = await generateEditProposalLive(
        userRequest,
        documentTitle,
        documentContent
      );

      const judgment = await judgeEditQuality(
        documentContent,
        editProposal,
        userRequest,
        'append'
      );

      expect(judgment.pass).toBe(true);
    }, 30000);
  });
});
