// convex/fileAnalysis.ts
"use node";

import { v } from "convex/values";
import { action } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  GoogleGenAI,
  createUserContent,
  createPartFromUri,
  FunctionDeclaration,
  Part,
  Type,
  FileState,
} from "@google/genai";
import { Id } from "../../_generated/dataModel";
import { getLlmModel } from "../../../shared/llm/modelCatalog";

// Type definitions
interface AnalysisResult {
  analysis: string;
  structuredData?: any;
}

const MAX_ANALYSIS_TOPICS = 10;
const MAX_TOPIC_CHARS = 80;
const OPENROUTER_DEFAULT_TIMEOUT_MS = 30_000;

function normalizeAnalysisTopics(topics: string[] | undefined): string[] {
  if (!topics || topics.length === 0) return [];

  const normalized = topics
    .map((topic) => (topic ?? "").trim())
    .filter(Boolean)
    .map((topic) => (topic.length > MAX_TOPIC_CHARS ? topic.slice(0, MAX_TOPIC_CHARS) : topic));

  const unique: string[] = [];
  for (const topic of normalized) {
    const key = topic.toLowerCase();
    if (unique.some((t) => t.toLowerCase() === key)) continue;
    unique.push(topic);
    if (unique.length >= MAX_ANALYSIS_TOPICS) break;
  }

  return unique;
}

function buildAnalysisPrompt(params: {
  analysisPrompt?: string;
  analysisTopics: string[];
  analysisType: string;
  file: { fileName?: string; fileType?: string };
}): string {
  const basePrompt = (params.analysisPrompt ?? "").trim();
  const topicsBlock = params.analysisTopics.length
    ? `\n\nFocus Topics (optional):\n- ${params.analysisTopics.join("\n- ")}\n\nIf a topic is not present in the content, explicitly say "not found" rather than guessing.`
    : "";

  const constraints = `\n\nConstraints:\n- Be token-efficient and avoid generic filler.\n- Quote short, relevant snippets when possible.\n- If the content includes dates, keep them (don't generalize timeframes).\n- File Info: Name: ${params.file.fileName || "Unknown"}, Type: ${params.file.fileType || "Unknown"}, AnalysisType: ${params.analysisType}`;

  if (basePrompt) return `${basePrompt}${topicsBlock}${constraints}`;

  if (!params.analysisTopics.length) {
    throw new Error("Either analysisPrompt or analysisTopics must be provided.");
  }

  return `Analyze the content focusing ONLY on the provided topics.${topicsBlock}${constraints}`;
}

function getOpenRouterHeaders(): Record<string, string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not configured");

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (process.env.OPENROUTER_HTTP_REFERER) headers["HTTP-Referer"] = process.env.OPENROUTER_HTTP_REFERER;
  if (process.env.OPENROUTER_X_TITLE) headers["X-Title"] = process.env.OPENROUTER_X_TITLE;
  return headers;
}

async function analyzeImageWithOpenRouter(args: {
  modelId: string;
  prompt: string;
  mimeType: string;
  imageBase64: string;
  timeoutMs?: number;
}): Promise<string> {
  const baseURL = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
  const imageUrl = `data:${args.mimeType};base64,${args.imageBase64}`;

  const response = await fetch(`${baseURL}/chat/completions`, {
    method: "POST",
    headers: getOpenRouterHeaders(),
    body: JSON.stringify({
      model: args.modelId,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: args.prompt },
            { type: "image_url", image_url: { url: imageUrl } },
          ],
        },
      ],
      max_tokens: 1600,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(args.timeoutMs ?? OPENROUTER_DEFAULT_TIMEOUT_MS),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter error ${response.status}: ${text}`);
  }

  const data = await response.json() as any;
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new Error("OpenRouter returned empty content");
  }
  return content;
}

export const analyzeFileWithGenAI = action({
  args: {
    fileId: v.optional(v.id("files")),
    url: v.optional(v.string()),
    analysisPrompt: v.optional(v.string()),
    analysisTopics: v.optional(v.array(v.string())),
    analysisType: v.optional(v.string()),
    testBypassUserId: v.optional(v.union(v.id("users"), v.string())),
  },
  handler: async (ctx, args) => {
    if (!args.fileId && !args.url) {
      throw new Error("Either a fileId or a url must be provided.");
    }

    const startTime = Date.now();
    // Using getAuthUserId for consistent authentication (with optional test bypass)
    const userId = (args).testBypassUserId || await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    // API key handling - you may want to implement getApiKey helper
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
    if (!apiKey) {
      throw new Error("Gemini API key not configured");
    }
    const ai = new GoogleGenAI({ apiKey });

    // Track files that need cleanup
    const filesToCleanUp: string[] = [];

    try {
      let contentParts: Part[];
      let sourceName: string;
      let fileType: string;
      let fileForAnalysis: any;
      let persistenceId: Id<"files">;
      let openRouterInlineImage: { mimeType: string; imageBase64: string } | null = null;

      if (args.fileId) {
        // --- PATH 1: Handle File Input ---
        persistenceId = args.fileId;
        const file = await ctx.runQuery(internal.domains.documents.files.getFile, {
          fileId: args.fileId,
        });
        
        if (!file) {
          throw new Error("File not found in database");
        }
        
        // Debug logging for permission issues
        console.log('File analysis access check:', {
          fileId: args.fileId,
          fileUserId: file.userId,
          currentUserId: userId,
          userIdMatch: file.userId === userId
        });
        
        if (file.userId !== userId) {
          throw new Error(`File access denied: file belongs to ${file.userId}, current user is ${userId}`);
        }

        const fileUrl = await ctx.storage.getUrl(file.storageId);
        if (!fileUrl) throw new Error("File not accessible from storage");
        
        const { fileBlob } = await downloadAndValidateFile(fileUrl, file.fileName, file.fileType);

        sourceName = file.fileName;
        fileType = file.fileType;
        fileForAnalysis = file;

        // Normalize MIME using DB value -> extension map -> magic-byte sniff
        const mimeType = await normalizeMimeType(file.mimeType, sourceName, fileType, fileBlob);
        
        if (isPreprocessableMime(mimeType)) {
          contentParts = await preprocessDocument(fileBlob, mimeType);
        } else if (mimeType.startsWith('image/')) {
          const buffer = Buffer.from(await fileBlob.arrayBuffer());
          const imageBase64 = buffer.toString("base64");
          contentParts = [{ inlineData: { data: imageBase64, mimeType } }];
          openRouterInlineImage = { mimeType, imageBase64 };
        } else {
          // Unknown/office/octet-stream/audio/video -> upload + wait path
          const uploadResult = await uploadFileToGenAI(ai, fileBlob, sourceName, mimeType);
          if (uploadResult.name) {
            const fileName = uploadResult.name; // Type-safe assignment
            filesToCleanUp.push(fileName); // Add to cleanup queue
            const processedFile = await waitForFileProcessing(ai, fileName);
            if (processedFile.uri && processedFile.mimeType) {
              contentParts = [createPartFromUri(processedFile.uri, processedFile.mimeType)];
            } else {
              throw new Error('File processing failed: missing URI or mimeType');
            }
          } else {
            throw new Error('File upload failed: no name returned');
          }
        }

      } else {
        // --- PATH 2: Handle URL Input ---
        const url = args.url!;
        sourceName = url;
        fileForAnalysis = { fileName: url, fileType: "url" };

        // Fixed: Using 'ai' instead of undefined 'genAI'
        const { parts, detectedFileType, uploadedFileName } = await handleUrlInput(url, ai);
        if (uploadedFileName) {
          filesToCleanUp.push(uploadedFileName); // Add to cleanup queue
        }
        contentParts = parts;
        fileType = detectedFileType;
        // For URLs, we'll use a simpler approach and skip the unified file system
        // Just store the URL for later reference
        fileForAnalysis = { fileName: url, fileType: "url" };
        persistenceId = null as any; // Will handle URL saving separately later
      }
      
      const analysisType = args.analysisType || fileType;
      const analysisTopics = normalizeAnalysisTopics(args.analysisTopics);
      const resolvedPrompt = buildAnalysisPrompt({
        analysisPrompt: args.analysisPrompt,
        analysisTopics,
        analysisType,
        file: fileForAnalysis,
      });
      const model = analysisTopics.length
        ? getLlmModel("analysis", "gemini", "gemini-3-flash-preview")
        : getLlmModel("analysis", "gemini");

      const wantsStructured = shouldUseStructuredAnalysis(resolvedPrompt, analysisType);

      // FREE-FIRST for screenshot/image analysis: if the input is an inline image and topics are provided,
      // try OpenRouter vision (Molmo) to reduce cost; fall back to Gemini on 429/5xx/etc.
      let analysisResult: AnalysisResult;
      if (
        openRouterInlineImage &&
        analysisTopics.length > 0 &&
        !wantsStructured &&
        (process.env.OPENROUTER_API_KEY || "").trim().length > 0
      ) {
        try {
          const openrouterText = await analyzeImageWithOpenRouter({
            modelId: "allenai/molmo-2-8b:free",
            prompt: resolvedPrompt,
            mimeType: openRouterInlineImage.mimeType,
            imageBase64: openRouterInlineImage.imageBase64,
          });
          analysisResult = { analysis: openrouterText, structuredData: null };
        } catch (err) {
          console.warn("[fileAnalysis] OpenRouter vision failed, falling back to Gemini.", err);
          analysisResult = await generateAnalysis(
            ai,
            contentParts,
            resolvedPrompt,
            analysisType,
            fileForAnalysis,
            model
          );
        }
      } else {
        analysisResult = await generateAnalysis(
          ai,
          contentParts,
          resolvedPrompt,
          analysisType,
          fileForAnalysis,
          model
        );
      }

      // Save analysis results - handle files vs URLs differently
      if (args.fileId && persistenceId) {
        // For file analysis, update the file record
        await ctx.runMutation(internal.domains.documents.files.updateFileAnalysis, {
          fileId: persistenceId,
          analysis: analysisResult.analysis,
          structuredData: analysisResult.structuredData,
          analysisType,
          processingTime: Date.now() - startTime,
        });
      } else if (args.url) {
        // For URL analysis, create a URL analysis record
        await ctx.runMutation(internal.domains.documents.files.createUrlAnalysis, {
          url: args.url,
          analysis: analysisResult.analysis,
          structuredData: analysisResult.structuredData,
          contentType: fileType,
          analysisType: args.analysisType,
          processingTime: Date.now() - startTime,
        });
      }

      return {
        success: true,
        analysis: analysisResult.analysis,
        sourceName: sourceName,
        structuredData: analysisResult.structuredData,
        processingTime: Date.now() - startTime,
      };

    } catch (error) {
      console.error("Analysis error:", error);
      // Log error but don't try to save to database due to type complexities
      console.error('Analysis failed for:', args.fileId ? `fileId: ${args.fileId}` : `url: ${args.url}`);
      console.error('Error details:', error);
      throw new Error(`Analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      // Reliable cleanup in finally block
      for (const fileName of filesToCleanUp) {
        await cleanupUploadedFile(ai, fileName);
      }
    }
  },
});

// --- Helper Functions ---

async function downloadAndValidateFile(
  fileUrl: string, 
  fileName: string, 
  fileType: string
): Promise<{ fileBlob: Blob; mimeType: string }> {
  const fileResponse = await fetch(fileUrl);
  if (!fileResponse.ok) {
    throw new Error(`Failed to fetch file: ${fileResponse.statusText}`);
  }
  const fileBlob = await fileResponse.blob();
  const mimeType = determineMimeType(fileName, fileType);
  return { fileBlob, mimeType };
}

async function handleUrlInput(
  url: string, 
  ai: GoogleGenAI
): Promise<{ parts: Part[], detectedFileType: string, uploadedFileName?: string }> {
  // Special handling for YouTube URLs
  if (url.includes("youtube.com/watch") || url.includes("youtu.be/")) {
    return { 
      parts: [{ fileData: { fileUri: url, mimeType: 'video/mp4' } }], 
      detectedFileType: 'video' 
    };
  }

  // Try fetching with a browser-like User-Agent to avoid common 403 blocks
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
  } catch {
    // Network-level failure, attempt readable proxy fallback below
    response = new Response(null, { status: 599, statusText: "Network Error" });
  }
  
  // Fallback: Use Jina Reader proxy when direct fetch is blocked (e.g., 403 Forbidden)
  if (!response.ok) {
    const stripped = url.replace(/^https?:\/\//, "");
    const jinaUrls = [
      `https://r.jina.ai/http://${stripped}`,
      `https://r.jina.ai/https://${stripped}`,
    ];
    let jinaResp: Response | null = null;
    for (const j of jinaUrls) {
      try {
        const r = await fetch(j, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
            Accept: "text/plain, text/html;q=0.9,*/*;q=0.8",
          },
        });
        if (r.ok) {
          jinaResp = r;
          break;
        }
      } catch {
        // try next
      }
    }
    if (jinaResp && jinaResp.ok) {
      const text = await jinaResp.text();
      const bodyText = text.trim().slice(0, 50000);
      return {
        parts: [{ text: `Extracted text from URL ${url} (via reader):\n\n${bodyText}` }],
        detectedFileType: "web",
      };
    }
    // If fallback also failed, surface original error
    throw new Error(`Failed to fetch URL: ${response.statusText || "Unknown error"}`);
  }

  const contentType = response.headers.get("content-type") || "";
  const fileBlob = await response.blob();
  
  if (contentType.startsWith("image/")) {
    const buffer = Buffer.from(await fileBlob.arrayBuffer());
    return { 
      parts: [{ inlineData: { data: buffer.toString("base64"), mimeType: contentType } }], 
      detectedFileType: "image" 
    };
  } else if (contentType.startsWith("video/") || contentType === "application/pdf") {
    const uploadResult = await uploadFileToGenAI(ai, fileBlob, url, contentType);
    if (!uploadResult.name) {
      throw new Error('File upload failed: no name returned');
    }
    const fileName = uploadResult.name; // Type-safe assignment
    const processedFile = await waitForFileProcessing(ai, fileName);
    if (!processedFile.uri || !processedFile.mimeType) {
      throw new Error('File processing failed: missing URI or mimeType');
    }
    // Return filename for cleanup instead of using unreliable setTimeout
    return {
      parts: [createPartFromUri(processedFile.uri, processedFile.mimeType)],
      detectedFileType: contentType === "application/pdf" ? 'document' : 'video',
      uploadedFileName: fileName,
    };
  } else { // Fallback for text/html, text/plain, etc.
    const text = await response.text();
    const bodyText = text
      .replace(/<style[^>]*>.*<\/style>/gs, '')
      .replace(/<script[^>]*>.*<\/script>/gs, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s\s+/g, ' ')
      .trim();
    return {
      parts: [{ text: `Extracted text from URL ${url}:\n\n${bodyText.substring(0, 50000)}` }],
      detectedFileType: "web",
    };
  }
}

async function preprocessDocument(fileBlob: Blob, mimeType: string): Promise<Part[]> {
  switch (mimeType) {
    case "application/pdf": {
      const buffer = Buffer.from(await fileBlob.arrayBuffer());
      return [{ inlineData: { data: buffer.toString("base64"), mimeType } }];
    }
      
    case "text/plain":
    case "text/markdown":
    case "text/csv":
    case "application/json": { // Added support for JSON files
      const textContent = await fileBlob.text();
      let hint = "";
      if (mimeType === "text/csv") hint = "The following content is from a CSV file:\n";
      else if (mimeType === "text/markdown") hint = "The following content is from a Markdown file:\n";
      else if (mimeType === "application/json") hint = "The following content is from a JSON file:\n";
      return [{ text: hint + textContent }];
    }
    
    // PATCH: Replaced the risky try/catch with an explicit error for unhandled types.
    // This prevents garbage data from being sent to the model.
    default:
      throw new Error(`Unsupported document MIME type for direct pre-processing: ${mimeType}. Consider converting it to a supported format like PDF or plain text.`);
  }
}

function determineMimeType(fileName: string, fileType: string): string {
  const extension = fileName.toLowerCase().split('.').pop() || '';
  const mimeTypes: Record<string, Record<string, string>> = {
    video: {
      "mp4": "video/mp4", 
      "mov": "video/quicktime", 
      "mpeg": "video/mpeg", 
      "avi": "video/x-msvideo", 
      "webm": "video/webm"
    },
    image: {
      "jpg": "image/jpeg", 
      "jpeg": "image/jpeg", 
      "png": "image/png", 
      "webp": "image/webp", 
      "gif": "image/gif"
    },
    audio: {
      "wav": "audio/wav", 
      "mp3": "audio/mpeg", 
      "aac": "audio/aac", 
      "ogg": "audio/ogg"
    },
    document: {
      "pdf": "application/pdf", 
      "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", 
      "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation", 
      "csv": "text/csv", 
      "txt": "text/plain", 
      "md": "text/markdown",
      "json": "application/json"
    }
  };
  return mimeTypes[fileType]?.[extension] || 'application/octet-stream';
}

// === MIME helpers (ADDED) ===
const PREPROCESSABLE_MIME = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
]);

function isPreprocessableMime(mime: string): boolean {
  if (!mime) return false;
  if (mime.startsWith("text/")) return true;
  return PREPROCESSABLE_MIME.has(mime);
}

async function sniffMimeTypeFromBytes(fileBlob: Blob, fileName: string): Promise<string | null> {
  try {
    const head = Buffer.from(await fileBlob.slice(0, 64).arrayBuffer());
    if (head.length >= 4) {
      // %PDF-
      if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) {
        return "application/pdf";
      }
      // ZIP magic (OOXML like docx/pptx/xlsx)
      if (head[0] === 0x50 && head[1] === 0x4b) {
        const ext = fileName.toLowerCase().split(".").pop() || "";
        if (ext === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        if (ext === "pptx") return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
        if (ext === "xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        return "application/zip";
      }
      // Heuristic for text (no NULs, mostly printable)
      let hasNull = false, printable = 0;
      for (const b of head) {
        if (b === 0x00) { hasNull = true; break; }
        if (b === 0x09 || b === 0x0a || b === 0x0d || (b >= 0x20 && b <= 0x7e)) printable++;
      }
      if (!hasNull && printable / head.length > 0.85) {
        const ext = fileName.toLowerCase().split(".").pop() || "";
        if (ext === "md") return "text/markdown";
        if (ext === "csv") return "text/csv";
        if (ext === "json") return "application/json";
        return "text/plain";
      }
    }
  } catch {
    // best-effort only
  }
  return null;
}

function mapExtToMimeByType(fileType: string, ext: string): string {
  const mimeTypes: Record<string, Record<string, string>> = {
    video: { mp4: "video/mp4", mov: "video/quicktime", mpeg: "video/mpeg", avi: "video/x-msvideo", webm: "video/webm" },
    image: { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" },
    audio: { wav: "audio/wav", mp3: "audio/mpeg", aac: "audio/aac", ogg: "audio/ogg" },
    document: {
      pdf: "application/pdf",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      csv: "text/csv",
      txt: "text/plain",
      md: "text/markdown",
      json: "application/json",
      rtf: "application/rtf",
    },
  };
  return mimeTypes[fileType]?.[ext] || "application/octet-stream";
}

async function normalizeMimeType(
  storedMime: string | undefined,
  fileName: string,
  fileType: string,
  fileBlob: Blob
): Promise<string> {
  // 1) DB value if present and not octet-stream/empty
  if (storedMime && storedMime !== "" && storedMime !== "application/octet-stream") return storedMime;

  // 2) Extension mapping by declared fileType
  const ext = fileName.toLowerCase().split(".").pop() || "";
  const byExt = mapExtToMimeByType(fileType, ext);
  if (byExt !== "application/octet-stream") return byExt;

  // 3) Magic-byte sniff (best-effort)
  const sniffed = await sniffMimeTypeFromBytes(fileBlob, fileName);
  if (sniffed) return sniffed;

  return "application/octet-stream";
}

// File upload functions
async function uploadFileToGenAI(
  ai: GoogleGenAI, 
  blob: Blob, 
  displayName: string, 
  mimeType: string
) {
  // Simplified: SDK accepts Blob directly
  const uploadResult = await ai.files.upload({
    file: blob,
    config: { displayName, mimeType },
  });
  // PATCH: The SDK returns the file object directly, not wrapped.
  // The uploadResult itself is the file object we need.
  return uploadResult;
}

async function waitForFileProcessing(ai: GoogleGenAI, fileName: string) {
  let file;
  for (let i = 0; i < 30; i++) { // Max 30 attempts (60 seconds)
    await new Promise(resolve => setTimeout(resolve, 2000));
    // Corrected: .get() expects an object with 'name' property
    file = await ai.files.get({ name: fileName });
    if (file.state === FileState.ACTIVE) return file;
    if (file.state === FileState.FAILED) {
      throw new Error(`File processing failed: ${file.error?.message || 'Unknown error'}`);
    }
  }
  throw new Error("File processing timeout");
}

async function cleanupUploadedFile(ai: GoogleGenAI, fileName: string) {
  try {
    // Corrected: .delete() expects an object with 'name' property
    await ai.files.delete({ name: fileName });
    console.log(`Cleaned up file: ${fileName}`);
  } catch (error) {
    console.warn(`Failed to cleanup file ${fileName}:`, error);
  }
}

// Analysis generation functions
async function generateAnalysis(
  ai: GoogleGenAI,
  contentParts: Part[], 
  analysisPrompt: string, 
  analysisType: string, 
  file: any,
  model: string
): Promise<AnalysisResult> {
  if (shouldUseStructuredAnalysis(analysisPrompt, analysisType)) {
    return await generateStructuredAnalysis(ai, contentParts, analysisPrompt, analysisType, file, model);
  } else {
    return await generateTextAnalysis(ai, contentParts, analysisPrompt, file, model);
  }
}

function shouldUseStructuredAnalysis(prompt: string, analysisType?: string): boolean {
  if (analysisType && ["highlights", "object-detection", "document", "audio", "video", "csv"].includes(analysisType)) {
    return true;
  }
  const keywords = ['highlight', 'timestamp', 'moment', 'scene', 'key point', 'object', 'table', 'structure', 'column'];
  return keywords.some(keyword => prompt.toLowerCase().includes(keyword));
}

async function generateStructuredAnalysis(
  ai: GoogleGenAI,
  contentParts: Part[], 
  analysisPrompt: string, 
  analysisType: string, 
  file: any,
  model: string
): Promise<AnalysisResult> {
  const analysisTool = getAnalysisTool(analysisType);
  const enhancedPrompt = `Analyze the provided content based on the following request: ${analysisPrompt}. 
  Use the "${analysisTool.name}" function to return the structured results. 
  File Info: Name: ${file.fileName}, Type: ${file.fileType || 'Unknown'}`;

  try {
    const result = await ai.models.generateContent({
      model,
      contents: createUserContent([...contentParts, enhancedPrompt]),
      config: { tools: [{ functionDeclarations: [analysisTool] }] },
    });

    const functionCall = result.functionCalls?.[0];
    
    if (functionCall && functionCall.name === analysisTool.name) {
      const structuredData = functionCall.args;
      const formattedAnalysis = formatStructuredAnalysis(structuredData, analysisType);
      return { analysis: formattedAnalysis, structuredData: structuredData };
    } else {
      console.warn("Model did not return expected function call, falling back to text analysis");
      return generateTextAnalysis(ai, contentParts, analysisPrompt, file, model);
    }
  } catch (error) {
    console.error("Structured analysis failed, falling back to text:", error);
    return generateTextAnalysis(ai, contentParts, analysisPrompt, file, model);
  }
}

async function generateTextAnalysis(
  ai: GoogleGenAI,
  contentParts: Part[], 
  analysisPrompt: string, 
  file: any,
  model: string
): Promise<AnalysisResult> {
  const enhancedPrompt = `Analyze this content based on the following request: ${analysisPrompt}. 
  Please provide a detailed text-based analysis. 
  File Info: Name: ${file.fileName}, Type: ${file.fileType || 'Unknown'}`;
  
  const response = await ai.models.generateContent({
    model,
    contents: createUserContent([...contentParts, enhancedPrompt]),
  });
  
  return { 
    analysis: response.text || "Unable to analyze file.", 
    structuredData: null 
  };
}

function getAnalysisTool(analysisType: string): FunctionDeclaration {
  const baseProperties = {
    summary: {
      type: Type.STRING,
      description: "Overall summary of the content analysis, 2-3 sentences long."
    }
  };
  
  let specificProperties = {};
  let description = "Records the analysis of a file or URL content.";
  const required = ["summary"];
  
  switch (analysisType) {
    case "highlights":
    case "video":
      description = "Analyzes video content to extract key highlights with timestamps.";
      specificProperties = {
        highlights: {
          type: Type.ARRAY,
          description: "Key moments or highlights from the video",
          items: {
            type: Type.OBJECT,
            properties: {
              timestamp: { type: Type.STRING, description: "Timestamp in MM:SS format" },
              description: { type: Type.STRING, description: "What happens at this moment" },
              importance: { type: Type.STRING, enum: ["high", "medium", "low"] }
            }
          }
        },
        topics: {
          type: Type.ARRAY,
          description: "Main topics discussed",
          items: { type: Type.STRING }
        }
      };
      required.push("highlights");
      break;
      
    case "object-detection":
    case "image":
      description = "Analyzes image content to identify objects and visual elements.";
      specificProperties = {
        objects: {
          type: Type.ARRAY,
          description: "Objects detected in the image",
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              confidence: { type: Type.NUMBER },
              location: { type: Type.STRING, description: "General location in image" }
            }
          }
        },
        scene: { type: Type.STRING, description: "Overall scene description" },
        colors: {
          type: Type.ARRAY,
          description: "Dominant colors",
          items: { type: Type.STRING }
        }
      };
      required.push("objects", "scene");
      break;
      
    case "document":
      description = "Analyzes document content to extract structure and key information.";
      specificProperties = {
        keyPoints: {
          type: Type.ARRAY,
          description: "Main points from the document",
          items: { type: Type.STRING }
        },
        structure: {
          type: Type.OBJECT,
          description: "Document structure analysis",
          properties: {
            sections: { type: Type.NUMBER },
            hasImages: { type: Type.BOOLEAN },
            hasTables: { type: Type.BOOLEAN },
            pageCount: { type: Type.NUMBER, nullable: true }
          }
        }
      };
      required.push("keyPoints");
      break;
      
    case "csv":
      description = "Analyzes CSV content to determine structure and data patterns.";
      specificProperties = {
        columnAnalysis: {
          type: Type.ARRAY,
          description: "Analysis of each column",
          items: {
            type: Type.OBJECT,
            properties: {
              columnName: { type: Type.STRING },
              dataType: { type: Type.STRING },
              description: { type: Type.STRING }
            }
          }
        },
        rowCount: { type: Type.NUMBER },
        dataPatterns: {
          type: Type.ARRAY,
          description: "Identified patterns in the data",
          items: { type: Type.STRING }
        },
        potentialVisualizations: {
          type: Type.ARRAY,
          description: "Suggestions for visualizing the data",
          items: { type: Type.STRING }
        }
      };
      required.push("columnAnalysis", "rowCount");
      break;
      
    case "audio":
      description = "Analyzes audio content for speech, music, and key moments.";
      specificProperties = {
        transcription: {
          type: Type.STRING,
          description: "Full or partial transcription of speech content"
        },
        speakers: {
          type: Type.ARRAY,
          description: "Identified speakers or voices",
          items: { type: Type.STRING }
        },
        audioElements: {
          type: Type.ARRAY,
          description: "Types of audio content detected",
          items: { type: Type.STRING }
        },
        keyMoments: {
          type: Type.ARRAY,
          description: "Notable moments in the audio",
          items: {
            type: Type.OBJECT,
            properties: {
              timestamp: { type: Type.STRING },
              description: { type: Type.STRING }
            }
          }
        }
      };
      break;
  }
  
  return {
    name: "record_content_analysis",
    description,
    parameters: {
      type: Type.OBJECT,
      properties: { ...baseProperties, ...specificProperties },
      required
    }
  };
}

function formatStructuredAnalysis(structuredData: any, analysisType: string): string {
  let formattedAnalysis = `**Analysis Summary:**\n${structuredData.summary || "Analysis completed"}\n\n`;
  
  switch (analysisType) {
    case "highlights":
    case "video":
      if (structuredData.highlights?.length > 0) {
        formattedAnalysis += "**Key Highlights:**\n";
        structuredData.highlights.forEach((h: any) => {
          formattedAnalysis += `- **[${h.timestamp}]** ${h.description}`;
          if (h.importance === "high") formattedAnalysis += " ⭐";
          formattedAnalysis += "\n";
        });
      }
      if (structuredData.topics?.length > 0) {
        formattedAnalysis += "\n**Topics Covered:**\n";
        structuredData.topics.forEach((t: string) => {
          formattedAnalysis += `• ${t}\n`;
        });
      }
      break;
      
    case "object-detection":
    case "image":
      if (structuredData.scene) {
        formattedAnalysis += `**Scene:** ${structuredData.scene}\n\n`;
      }
      if (structuredData.objects?.length > 0) {
        formattedAnalysis += "**Objects Detected:**\n";
        structuredData.objects.forEach((obj: any) => {
          formattedAnalysis += `- ${obj.name}`;
          if (obj.confidence) {
            formattedAnalysis += ` (${Math.round(obj.confidence * 100)}% confidence)`;
          }
          if (obj.location) formattedAnalysis += ` - ${obj.location}`;
          formattedAnalysis += "\n";
        });
      }
      if (structuredData.colors?.length > 0) {
        formattedAnalysis += `\n**Dominant Colors:** ${structuredData.colors.join(", ")}\n`;
      }
      break;
      
    case "document":
      if (structuredData.keyPoints?.length > 0) {
        formattedAnalysis += "**Key Points:**\n";
        structuredData.keyPoints.forEach((point: string) => {
          formattedAnalysis += `• ${point}\n`;
        });
      }
      if (structuredData.structure) {
        formattedAnalysis += "\n**Document Structure:**\n";
        if (structuredData.structure.sections) {
          formattedAnalysis += `- Sections: ${structuredData.structure.sections}\n`;
        }
        if (structuredData.structure.pageCount) {
          formattedAnalysis += `- Pages: ${structuredData.structure.pageCount}\n`;
        }
        formattedAnalysis += `- Contains Images: ${structuredData.structure.hasImages ? "Yes" : "No"}\n`;
        formattedAnalysis += `- Contains Tables: ${structuredData.structure.hasTables ? "Yes" : "No"}\n`;
      }
      break;
      
    case "csv":
      if (structuredData.columnAnalysis?.length > 0) {
        formattedAnalysis += `**CSV Structure (${structuredData.rowCount || 0} rows):**\n\n`;
        formattedAnalysis += "**Columns:**\n";
        structuredData.columnAnalysis.forEach((col: any) => {
          formattedAnalysis += `- **${col.columnName}** (${col.dataType}): ${col.description}\n`;
        });
      }
      if (structuredData.dataPatterns?.length > 0) {
        formattedAnalysis += "\n**Data Patterns:**\n";
        structuredData.dataPatterns.forEach((pattern: string) => {
          formattedAnalysis += `• ${pattern}\n`;
        });
      }
      if (structuredData.potentialVisualizations?.length > 0) {
        formattedAnalysis += "\n**Suggested Visualizations:**\n";
        structuredData.potentialVisualizations.forEach((viz: string) => {
          formattedAnalysis += `• ${viz}\n`;
        });
      }
      break;
      
    case "audio":
      if (structuredData.transcription) {
        formattedAnalysis += `**Transcription:**\n${structuredData.transcription}\n\n`;
      }
      if (structuredData.speakers?.length > 0) {
        formattedAnalysis += `**Speakers:** ${structuredData.speakers.join(", ")}\n`;
      }
      if (structuredData.audioElements?.length > 0) {
        formattedAnalysis += `**Audio Elements:** ${structuredData.audioElements.join(", ")}\n`;
      }
      if (structuredData.keyMoments?.length > 0) {
        formattedAnalysis += "\n**Key Moments:**\n";
        structuredData.keyMoments.forEach((moment: any) => {
          formattedAnalysis += `- **[${moment.timestamp}]** ${moment.description}\n`;
        });
      }
      break;
  }
  
  return formattedAnalysis;
}
