/**
 * Diagnostic Test - Check API key availability
 */

"use node";

import { v } from "convex/values";
import { action } from "../../_generated/server";

export const checkApiKeys = action({
  args: {},
  returns: v.object({
    serperKey: v.boolean(),
    geminiKey: v.boolean(),
    openaiKey: v.boolean(),
    linkupKey: v.boolean(),
    anthropicKey: v.boolean(),
  }),
  handler: async () => {
    return {
      serperKey: !!process.env.SERPER_API_KEY,
      geminiKey: !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY),
      openaiKey: !!process.env.OPENAI_API_KEY,
      linkupKey: !!process.env.LINKUP_API_KEY,
      anthropicKey: !!process.env.ANTHROPIC_API_KEY,
    };
  },
});

export const testSerperSearch = action({
  args: {
    query: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    error: v.optional(v.string()),
    resultsCount: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    const SERPER_API_KEY = process.env.SERPER_API_KEY;

    if (!SERPER_API_KEY) {
      return { success: false, error: "SERPER_API_KEY not configured" };
    }

    try {
      const response = await fetch("https://google.serper.dev/images", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": SERPER_API_KEY,
        },
        body: JSON.stringify({
          q: args.query,
          num: 5,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, error: `API error ${response.status}: ${errorText.slice(0, 100)}` };
      }

      const data = await response.json();
      return {
        success: true,
        resultsCount: data.images?.length || 0,
      };
    } catch (error) {
      return { success: false, error: `Exception: ${error}` };
    }
  },
});

export const testGeminiVision = action({
  args: {
    imageUrl: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    error: v.optional(v.string()),
    responseLength: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;

    if (!GEMINI_API_KEY) {
      return { success: false, error: "GEMINI_API_KEY not configured" };
    }

    try {
      // Fetch image
      const imageResponse = await fetch(args.imageUrl);
      if (!imageResponse.ok) {
        return { success: false, error: `Failed to fetch image: ${imageResponse.status}` };
      }

      const imageBlob = await imageResponse.blob();
      const imageBase64 = Buffer.from(await imageBlob.arrayBuffer()).toString("base64");
      const mimeType = imageResponse.headers.get("content-type") || "image/jpeg";

      // Call Gemini
      const { GoogleGenAI, createUserContent } = await import("@google/genai");
      const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

      const contents = createUserContent([
        { inlineData: { data: imageBase64, mimeType } },
        { text: "Describe this image briefly. What text is visible?" },
      ]);

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents,
      });

      const responseText = response.text || "";

      return {
        success: true,
        responseLength: responseText.length,
      };
    } catch (error) {
      return { success: false, error: `Exception: ${error}` };
    }
  },
});

export const testEntityExtraction = action({
  args: {},
  returns: v.object({
    success: v.boolean(),
    error: v.optional(v.string()),
    peopleFound: v.optional(v.number()),
    companiesFound: v.optional(v.number()),
  }),
  handler: async () => {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

    if (!OPENAI_API_KEY) {
      return { success: false, error: "OPENAI_API_KEY not configured" };
    }

    try {
      const { generateText } = await import("ai");
      const { openai } = await import("@ai-sdk/openai");

      const testText = "OpenAI CEO Sam Altman met with Microsoft CEO Satya Nadella to discuss AI safety.";

      const result = await generateText({
        model: openai.chat("gpt-5.4-nano"),
        prompt: `Extract people and companies from: "${testText}". Return JSON: {"people": ["name"], "companies": ["name"]}`,
        temperature: 0.1,
      });

      const jsonMatch = result.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const extracted = JSON.parse(jsonMatch[0]);
        return {
          success: true,
          peopleFound: extracted.people?.length || 0,
          companiesFound: extracted.companies?.length || 0,
        };
      }

      return { success: false, error: "Could not parse response" };
    } catch (error) {
      return { success: false, error: `Exception: ${error}` };
    }
  },
});

/**
 * Test reverse image search with actual image URL
 */
export const testReverseImageSearch = action({
  args: {
    imageUrl: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    error: v.optional(v.string()),
    resultsCount: v.optional(v.number()),
    relatedPagesCount: v.optional(v.number()),
    sampleResult: v.optional(v.object({
      title: v.optional(v.string()),
      source: v.optional(v.string()),
    })),
  }),
  handler: async (ctx, args) => {
    const SERPER_API_KEY = process.env.SERPER_API_KEY;

    if (!SERPER_API_KEY) {
      return { success: false, error: "SERPER_API_KEY not configured" };
    }

    try {
      // Step 1: Use reverse image search to find pages with this image
      const reverseSearchResponse = await fetch("https://google.serper.dev/images", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": SERPER_API_KEY,
        },
        body: JSON.stringify({
          q: `site:* ${args.imageUrl}`,
          num: 10,
        }),
      });

      if (!reverseSearchResponse.ok) {
        // Fallback: do a contextual search based on image name
        const imageName = args.imageUrl.split("/").pop()?.split(".")[0] || "image";

        const fallbackResponse = await fetch("https://google.serper.dev/search", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-KEY": SERPER_API_KEY,
          },
          body: JSON.stringify({
            q: imageName.replace(/[-_]/g, " "),
            num: 10,
          }),
        });

        if (!fallbackResponse.ok) {
          return { success: false, error: `API error: ${fallbackResponse.status}` };
        }

        const fallbackData = await fallbackResponse.json();
        return {
          success: true,
          resultsCount: fallbackData.organic?.length || 0,
          relatedPagesCount: fallbackData.relatedSearches?.length || 0,
          sampleResult: fallbackData.organic?.[0] ? {
            title: fallbackData.organic[0].title,
            source: fallbackData.organic[0].link,
          } : undefined,
        };
      }

      const data = await reverseSearchResponse.json();
      return {
        success: true,
        resultsCount: data.images?.length || 0,
        relatedPagesCount: data.relatedSearches?.length || 0,
        sampleResult: data.images?.[0] ? {
          title: data.images[0].title,
          source: data.images[0].source,
        } : undefined,
      };
    } catch (error) {
      return { success: false, error: `Exception: ${error}` };
    }
  },
});

/**
 * Test full OCR + context analysis pipeline
 */
export const testFullImageAnalysis = action({
  args: {
    imageUrl: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    error: v.optional(v.string()),
    analysis: v.optional(v.object({
      description: v.optional(v.union(v.string(), v.null())),
      visibleText: v.optional(v.union(v.string(), v.null())),
      identifiedPeople: v.optional(v.array(v.string())),
      identifiedOrganizations: v.optional(v.array(v.string())),
    })),
    processingTime: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;

    if (!GEMINI_API_KEY) {
      return { success: false, error: "GEMINI_API_KEY not configured" };
    }

    const startTime = Date.now();

    try {
      // Fetch the image
      const imageResponse = await fetch(args.imageUrl);
      if (!imageResponse.ok) {
        return { success: false, error: `Failed to fetch image: ${imageResponse.status}` };
      }

      const imageBlob = await imageResponse.blob();
      const imageBase64 = Buffer.from(await imageBlob.arrayBuffer()).toString("base64");
      const mimeType = imageResponse.headers.get("content-type") || "image/jpeg";

      // Analyze with Gemini
      const { GoogleGenAI, createUserContent } = await import("@google/genai");
      const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

      const contents = createUserContent([
        { inlineData: { data: imageBase64, mimeType } },
        { text: `Analyze this image for research purposes. Extract:
1. A brief description of what the image shows
2. Any visible text (OCR)
3. Names of people who might be identifiable from context clues (NOT facial recognition - use name tags, captions, podium signs, etc.)
4. Organizations or companies visible (logos, signs, badges)

Return JSON:
{
  "description": "...",
  "visibleText": "...",
  "identifiedPeople": ["name1", "name2"],
  "identifiedOrganizations": ["org1", "org2"]
}` },
      ]);

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents,
      });

      const responseText = response.text || "";
      const processingTime = Date.now() - startTime;

      // Parse JSON from response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const analysis = JSON.parse(jsonMatch[0]);
        return {
          success: true,
          analysis: {
            description: analysis.description,
            visibleText: analysis.visibleText,
            identifiedPeople: analysis.identifiedPeople || [],
            identifiedOrganizations: analysis.identifiedOrganizations || [],
          },
          processingTime,
        };
      }

      return {
        success: true,
        analysis: {
          description: responseText.slice(0, 500),
        },
        processingTime,
      };
    } catch (error) {
      return { success: false, error: `Exception: ${error}` };
    }
  },
});

/**
 * Run full E2E test of image research pipeline
 */
export const runFullE2ETest = action({
  args: {},
  returns: v.object({
    overallSuccess: v.boolean(),
    tests: v.array(v.object({
      name: v.string(),
      success: v.boolean(),
      details: v.optional(v.string()),
      duration: v.number(),
    })),
    summary: v.string(),
  }),
  handler: async () => {
    const results: Array<{
      name: string;
      success: boolean;
      details?: string;
      duration: number;
    }> = [];

    // Test 1: API Keys
    const apiKeyStart = Date.now();
    const apiKeys = {
      serper: !!process.env.SERPER_API_KEY,
      gemini: !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY),
      openai: !!process.env.OPENAI_API_KEY,
    };
    results.push({
      name: "API Keys Configured",
      success: apiKeys.serper && apiKeys.gemini && apiKeys.openai,
      details: `Serper: ${apiKeys.serper}, Gemini: ${apiKeys.gemini}, OpenAI: ${apiKeys.openai}`,
      duration: Date.now() - apiKeyStart,
    });

    // Test 2: Serper Image Search
    const serperStart = Date.now();
    try {
      const response = await fetch("https://google.serper.dev/images", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": process.env.SERPER_API_KEY!,
        },
        body: JSON.stringify({ q: "Elon Musk Tesla", num: 3 }),
      });
      const data = await response.json();
      results.push({
        name: "Serper Image Search",
        success: response.ok && (data.images?.length > 0),
        details: `Found ${data.images?.length || 0} images`,
        duration: Date.now() - serperStart,
      });
    } catch (error) {
      results.push({
        name: "Serper Image Search",
        success: false,
        details: `Error: ${error}`,
        duration: Date.now() - serperStart,
      });
    }

    // Test 3: Gemini Vision (using a public test image)
    const geminiStart = Date.now();
    try {
      const testImageUrl = "https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/280px-PNG_transparency_demonstration_1.png";
      const imageResponse = await fetch(testImageUrl);
      const imageBlob = await imageResponse.blob();
      const imageBase64 = Buffer.from(await imageBlob.arrayBuffer()).toString("base64");

      const { GoogleGenAI, createUserContent } = await import("@google/genai");
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY! });

      const contents = createUserContent([
        { inlineData: { data: imageBase64, mimeType: "image/png" } },
        { text: "What do you see in this image? Reply briefly." },
      ]);

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents,
      });

      results.push({
        name: "Gemini Vision Analysis",
        success: (response.text?.length || 0) > 10,
        details: `Response length: ${response.text?.length || 0} chars`,
        duration: Date.now() - geminiStart,
      });
    } catch (error) {
      results.push({
        name: "Gemini Vision Analysis",
        success: false,
        details: `Error: ${error}`,
        duration: Date.now() - geminiStart,
      });
    }

    // Test 4: OpenAI Entity Extraction
    const openaiStart = Date.now();
    try {
      const { generateText } = await import("ai");
      const { openai } = await import("@ai-sdk/openai");

      const result = await generateText({
        model: openai.chat("gpt-5.4-nano"),
        prompt: 'Extract entities from: "Tim Cook announced new iPhone at Apple Park". Return JSON: {"people": [], "companies": [], "products": []}',
        temperature: 0.1,
      });

      const jsonMatch = result.text.match(/\{[\s\S]*\}/);
      const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;

      results.push({
        name: "OpenAI Entity Extraction",
        success: parsed && (parsed.people?.length > 0 || parsed.companies?.length > 0),
        details: `People: ${parsed?.people?.length || 0}, Companies: ${parsed?.companies?.length || 0}`,
        duration: Date.now() - openaiStart,
      });
    } catch (error) {
      results.push({
        name: "OpenAI Entity Extraction",
        success: false,
        details: `Error: ${error}`,
        duration: Date.now() - openaiStart,
      });
    }

    const overallSuccess = results.every(r => r.success);
    const passedCount = results.filter(r => r.success).length;

    return {
      overallSuccess,
      tests: results,
      summary: `${passedCount}/${results.length} tests passed. ${overallSuccess ? "All image research tools are functional!" : "Some tests failed - see details above."}`,
    };
  },
});
