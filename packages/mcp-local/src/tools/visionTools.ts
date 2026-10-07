/**
 * Vision tools — AI-powered visual analysis, environment discovery, and image manipulation.
 * Enables the agentic vision loop: Capture → Analyze → Manipulate → Iterate → Gate.
 *
 * - discover_vision_env: Scans for available API keys and SDKs
 * - analyze_screenshot: Sends screenshots to vision models for analysis
 * - manipulate_screenshot: Crop, resize, annotate images using sharp
 *
 * All AI SDKs and sharp are optional dependencies — tools fail gracefully if missing.
 */

import { join } from "path";
import { homedir } from "os";
import { mkdirSync, existsSync, writeFileSync } from "fs";
import type { McpTool, ContentBlock, RawToolResult } from "../types.js";

const CAPTURE_DIR = join(homedir(), ".nodebench", "captures");

function ensureCaptureDir(): string {
  if (!existsSync(CAPTURE_DIR)) {
    mkdirSync(CAPTURE_DIR, { recursive: true });
  }
  return CAPTURE_DIR;
}

// ─── Dynamic import helpers ───────────────────────────────────────────────────

async function canImport(pkg: string): Promise<boolean> {
  try {
    await import(pkg);
    return true;
  } catch {
    return false;
  }
}

async function getSharp(): Promise<any | null> {
  try {
    const mod = await import("sharp");
    return mod.default ?? mod;
  } catch {
    return null;
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ─── Default analysis prompt ──────────────────────────────────────────────────

const DEFAULT_ANALYSIS_PROMPT = `Analyze this UI screenshot for quality issues. Evaluate:

1. LAYOUT: Is the layout balanced? Any overlapping elements, broken grids, or misaligned components?
2. SPACING: Is whitespace consistent? Any cramped or overly sparse areas?
3. TYPOGRAPHY: Are font sizes readable? Is there clear visual hierarchy (headings, body, captions)?
4. COLOR & CONTRAST: Are text/background combinations readable? Does it follow WCAG 2.1 AA contrast ratios?
5. RESPONSIVENESS: Does the layout look appropriate for its viewport width?
6. COMPONENT STATES: Are there visible loading spinners, error states, or empty states that look broken?
7. VISUAL CONSISTENCY: Do colors, borders, shadows, and rounding match a consistent design system?
8. ACCESSIBILITY: Are interactive elements visually distinct? Are focus indicators visible?

For each issue found, describe:
- What the issue is
- Where it is (describe the location in the screenshot)
- Severity: CRITICAL (broken/unusable), HIGH (visually wrong), MEDIUM (suboptimal), LOW (nitpick)
- Suggested fix

End with a summary: total issues by severity, overall quality score (1-10), and top 3 action items.`;

// ─── Provider implementations ─────────────────────────────────────────────────

async function analyzeWithGemini(
  imageBase64: string,
  prompt: string
): Promise<{ text: string; images: string[] }> {
  const { GoogleGenAI } = await import("@google/genai");
  const apiKey =
    process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || "";
  const ai = new GoogleGenAI({ apiKey });

  const response = await ai.models.generateContent({
    model: "gemini-3-flash",
    contents: [
      {
        role: "user" as const,
        parts: [
          { text: prompt },
          { inlineData: { mimeType: "image/png", data: imageBase64 } },
        ],
      },
    ],
    config: {
      tools: [{ codeExecution: {} }],
      maxOutputTokens: 8192,
      temperature: 0.2,
    },
  });

  // Extract text and any generated images from code execution
  const parts = (response as any)?.candidates?.[0]?.content?.parts ?? [];
  const textParts: string[] = [];
  const images: string[] = [];

  for (const part of parts) {
    if (part.text) textParts.push(part.text);
    if (part.executableCode)
      textParts.push(`\`\`\`python\n${part.executableCode.code}\n\`\`\``);
    if (part.codeExecutionResult)
      textParts.push(`Output: ${part.codeExecutionResult.output}`);
    if (part.inlineData?.data) images.push(part.inlineData.data);
  }

  return { text: textParts.join("\n\n"), images };
}

async function analyzeWithOpenAI(
  imageBase64: string,
  prompt: string
): Promise<{ text: string }> {
  const OpenAI = (await import("openai")).default;
  const client = new OpenAI();

  const response = await client.chat.completions.create({
    model: "gpt-5-mini",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          {
            type: "image_url",
            image_url: { url: `data:image/png;base64,${imageBase64}` },
          },
        ],
      },
    ],
    max_tokens: 4096,
  });

  return { text: response.choices[0]?.message?.content ?? "" };
}

async function analyzeWithAnthropic(
  imageBase64: string,
  prompt: string
): Promise<{ text: string }> {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic();

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: imageBase64,
            },
          },
          { type: "text", text: prompt },
        ],
      },
    ],
  });

  const text = response.content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n");

  return { text };
}

async function analyzeWithOpenRouter(
  imageBase64: string,
  prompt: string
): Promise<{ text: string }> {
  const OpenAI = (await import("openai")).default;
  const client = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
  });

  const response = await client.chat.completions.create({
    model: "google/gemini-3-flash",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          {
            type: "image_url",
            image_url: { url: `data:image/png;base64,${imageBase64}` },
          },
        ],
      },
    ],
    max_tokens: 4096,
  });

  return { text: response.choices[0]?.message?.content ?? "" };
}

// ─── Tools ────────────────────────────────────────────────────────────────────

export const visionTools: McpTool[] = [
  {
    name: "discover_vision_env",
    description:
      "Discover available vision-capable AI SDKs and API keys in the current environment. Returns which providers can be used for screenshot analysis. Call this before analyze_screenshot to know what's available. Checks: GEMINI_API_KEY (agentic vision with code execution), OPENAI_API_KEY (GPT-5-mini vision), ANTHROPIC_API_KEY (Claude vision), OPENROUTER_API_KEY. Also checks for sharp (image manipulation) and playwright (screenshot capture).",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async () => {
      const keys = {
        GEMINI_API_KEY: !!process.env.GEMINI_API_KEY,
        GOOGLE_AI_API_KEY: !!process.env.GOOGLE_AI_API_KEY,
        OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
        ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
        OPENROUTER_API_KEY: !!process.env.OPENROUTER_API_KEY,
      };

      const sdks = {
        googleGenai: await canImport("@google/genai"),
        openai: await canImport("openai"),
        anthropic: await canImport("@anthropic-ai/sdk"),
        sharp: await canImport("sharp"),
        playwright: await canImport("playwright"),
      };

      const providers: Array<{
        name: string;
        model: string;
        priority: number;
        features: string[];
      }> = [];

      if ((keys.GEMINI_API_KEY || keys.GOOGLE_AI_API_KEY) && sdks.googleGenai) {
        providers.push({
          name: "gemini",
          model: "gemini-3-flash",
          priority: 1,
          features: ["vision", "code_execution", "agentic_vision"],
        });
      }
      if (keys.OPENAI_API_KEY && sdks.openai) {
        providers.push({
          name: "openai",
          model: "gpt-5-mini",
          priority: 2,
          features: ["vision"],
        });
      }
      if (keys.ANTHROPIC_API_KEY && sdks.anthropic) {
        providers.push({
          name: "anthropic",
          model: "claude-haiku-4-5-20251001",
          priority: 3,
          features: ["vision"],
        });
      }
      if (keys.OPENROUTER_API_KEY && sdks.openai) {
        providers.push({
          name: "openrouter",
          model: "google/gemini-3-flash",
          priority: 4,
          features: ["vision"],
        });
      }

      providers.sort((a, b) => a.priority - b.priority);

      return {
        apiKeys: keys,
        sdks,
        providers,
        bestProvider: providers[0] ?? null,
        canAnalyze: providers.length > 0,
        canManipulate: sdks.sharp,
        canCapture: sdks.playwright,
        recommendation:
          providers.length === 0
            ? "No vision providers available. Set an API key and install the SDK. Recommended: npm install @google/genai && set GEMINI_API_KEY for agentic vision with code execution."
            : `Best provider: ${providers[0].name} (${providers[0].model}). ${providers[0].features.includes("code_execution") ? "Supports agentic vision with code execution (zoom, crop, compute)." : "Standard vision analysis."}`,
      };
    },
  },
  {
    name: "analyze_screenshot",
    description:
      "Send a screenshot to a vision-capable AI model for analysis. Accepts base64 image data (from capture_ui_screenshot) and returns the model's analysis of layout, spacing, typography, accessibility, and visual quality. Auto-selects the best available provider — Gemini with code execution (agentic vision: zoom, crop, annotate, compute) > OpenAI GPT-5-mini > Anthropic Claude > OpenRouter. Call discover_vision_env first to check availability.",
    rawContent: true,
    inputSchema: {
      type: "object",
      properties: {
        imageBase64: {
          type: "string",
          description:
            "Base64-encoded PNG image data (from capture_ui_screenshot output)",
        },
        prompt: {
          type: "string",
          description:
            "Custom analysis prompt. Default: comprehensive UI/UX review covering layout, spacing, typography, color, accessibility, responsiveness.",
        },
        provider: {
          type: "string",
          enum: ["auto", "gemini", "openai", "anthropic", "openrouter"],
          description:
            "Which vision provider to use. Default: 'auto' (selects best available).",
        },
        context: {
          type: "string",
          description:
            "Additional context about what was captured (component name, expected behavior, known issues).",
        },
      },
      required: ["imageBase64"],
    },
    handler: async (args): Promise<RawToolResult> => {
      const providerChoice = args.provider ?? "auto";
      const analysisPrompt = args.context
        ? `Context: ${args.context}\n\n${args.prompt ?? DEFAULT_ANALYSIS_PROMPT}`
        : args.prompt ?? DEFAULT_ANALYSIS_PROMPT;

      // Determine which provider to use
      type ProviderName = "gemini" | "openai" | "anthropic" | "openrouter";
      let selectedProvider: ProviderName | null = null;

      if (providerChoice !== "auto") {
        selectedProvider = providerChoice as ProviderName;
      } else {
        // Auto-select: Gemini > OpenAI > Anthropic > OpenRouter
        if (
          (process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY) &&
          (await canImport("@google/genai"))
        ) {
          selectedProvider = "gemini";
        } else if (
          process.env.OPENAI_API_KEY &&
          (await canImport("openai"))
        ) {
          selectedProvider = "openai";
        } else if (
          process.env.ANTHROPIC_API_KEY &&
          (await canImport("@anthropic-ai/sdk"))
        ) {
          selectedProvider = "anthropic";
        } else if (
          process.env.OPENROUTER_API_KEY &&
          (await canImport("openai"))
        ) {
          selectedProvider = "openrouter";
        }
      }

      if (!selectedProvider) {
        return {
          error: true,
          message:
            "No vision provider available. Call discover_vision_env to see what's needed.",
          suggestion:
            "Set one of: GEMINI_API_KEY (recommended), OPENAI_API_KEY, ANTHROPIC_API_KEY, or OPENROUTER_API_KEY. " +
            "Also install the corresponding SDK: @google/genai, openai, or @anthropic-ai/sdk.",
        };
      }

      try {
        let result: { text: string; images?: string[] };

        switch (selectedProvider) {
          case "gemini":
            result = await analyzeWithGemini(args.imageBase64, analysisPrompt);
            break;
          case "openai":
            result = await analyzeWithOpenAI(args.imageBase64, analysisPrompt);
            break;
          case "anthropic":
            result = await analyzeWithAnthropic(
              args.imageBase64,
              analysisPrompt
            );
            break;
          case "openrouter":
            result = await analyzeWithOpenRouter(
              args.imageBase64,
              analysisPrompt
            );
            break;
        }

        const content: ContentBlock[] = [
          {
            type: "text",
            text: JSON.stringify({
              provider: selectedProvider,
              model:
                selectedProvider === "gemini"
                  ? "gemini-3-flash"
                  : selectedProvider === "openai"
                    ? "gpt-5-mini"
                    : selectedProvider === "anthropic"
                      ? "claude-haiku-4-5-20251001"
                      : "google/gemini-3-flash",
              agenticVision:
                selectedProvider === "gemini"
                  ? "enabled (code execution active)"
                  : "not available (standard vision only)",
              annotatedImagesCount: result.images?.length ?? 0,
            }),
          },
          { type: "text", text: result.text },
        ];

        // Append any annotated images from Gemini code execution
        if (result.images && result.images.length > 0) {
          for (const img of result.images) {
            content.push({
              type: "image",
              data: img,
              mimeType: "image/png",
            });
          }
        }

        return content;
      } catch (err: any) {
        return {
          error: true,
          provider: selectedProvider,
          message: `Vision analysis failed: ${err.message}`,
          suggestion:
            "Check that the API key is valid and the SDK is installed. Try a different provider with provider='openai' or provider='anthropic'.",
        };
      }
    },
  },
  {
    name: "manipulate_screenshot",
    description:
      "Manipulate a screenshot using sharp (image processing). Supports crop (extract a region), resize, and annotate (draw colored rectangles and labels to highlight areas). Use after analyze_screenshot identifies regions of interest, or to prepare focused crops for deeper analysis. Returns the processed image as base64. Requires sharp to be installed.",
    rawContent: true,
    inputSchema: {
      type: "object",
      properties: {
        imageBase64: {
          type: "string",
          description: "Base64-encoded PNG image to manipulate",
        },
        operation: {
          type: "string",
          enum: ["crop", "resize", "annotate"],
          description:
            "Operation: crop (extract region), resize (change dimensions), annotate (draw rectangles/labels)",
        },
        x: { type: "number", description: "Crop: left offset in pixels" },
        y: { type: "number", description: "Crop: top offset in pixels" },
        cropWidth: {
          type: "number",
          description: "Crop: width of region in pixels",
        },
        cropHeight: {
          type: "number",
          description: "Crop: height of region in pixels",
        },
        width: { type: "number", description: "Resize: target width" },
        height: { type: "number", description: "Resize: target height" },
        annotations: {
          type: "array",
          description: "Annotate: rectangles and labels to draw on the image",
          items: {
            type: "object",
            properties: {
              x: { type: "number", description: "Left offset" },
              y: { type: "number", description: "Top offset" },
              width: { type: "number", description: "Rectangle width" },
              height: { type: "number", description: "Rectangle height" },
              color: {
                type: "string",
                description: "CSS color for the rectangle (default: red)",
              },
              label: {
                type: "string",
                description: "Text label above the rectangle",
              },
            },
            required: ["x", "y", "width", "height"],
          },
        },
        label: {
          type: "string",
          description:
            "Label for the output (used in saved filename, e.g. 'cropped-nav-mobile')",
        },
      },
      required: ["imageBase64", "operation"],
    },
    handler: async (args): Promise<RawToolResult> => {
      const sharp = await getSharp();
      if (!sharp) {
        return {
          error: true,
          message:
            "sharp is not installed. Install it with: npm install sharp",
          suggestion:
            "The manipulate_screenshot tool requires sharp for image processing.",
        };
      }

      const inputBuffer = Buffer.from(args.imageBase64, "base64");

      try {
        let outputBuffer: Buffer;

        switch (args.operation) {
          case "crop": {
            if (
              args.x == null ||
              args.y == null ||
              !args.cropWidth ||
              !args.cropHeight
            ) {
              throw new Error(
                "Crop requires x, y, cropWidth, and cropHeight parameters"
              );
            }
            outputBuffer = await sharp(inputBuffer)
              .extract({
                left: Math.round(args.x),
                top: Math.round(args.y),
                width: Math.round(args.cropWidth),
                height: Math.round(args.cropHeight),
              })
              .png()
              .toBuffer();
            break;
          }

          case "resize": {
            if (!args.width && !args.height) {
              throw new Error(
                "Resize requires at least one of width or height"
              );
            }
            outputBuffer = await sharp(inputBuffer)
              .resize(args.width ?? null, args.height ?? null, {
                fit: "inside",
              })
              .png()
              .toBuffer();
            break;
          }

          case "annotate": {
            if (!args.annotations || args.annotations.length === 0) {
              throw new Error(
                "Annotate requires at least one annotation in the annotations array"
              );
            }
            const metadata = await sharp(inputBuffer).metadata();
            const w = metadata.width ?? 1280;
            const h = metadata.height ?? 800;

            const svgParts = (args.annotations as any[]).map((a) => {
              const color = a.color || "red";
              const labelSvg = a.label
                ? `<text x="${a.x + 2}" y="${a.y - 6}" fill="${color}" font-size="14" font-family="Arial, sans-serif" font-weight="bold">${escapeXml(a.label)}</text>`
                : "";
              return `${labelSvg}<rect x="${a.x}" y="${a.y}" width="${a.width}" height="${a.height}" fill="none" stroke="${color}" stroke-width="3"/>`;
            });

            const svgOverlay = Buffer.from(
              `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">${svgParts.join("")}</svg>`
            );

            outputBuffer = await sharp(inputBuffer)
              .composite([{ input: svgOverlay, top: 0, left: 0 }])
              .png()
              .toBuffer();
            break;
          }

          default:
            throw new Error(
              `Unknown operation: ${args.operation}. Use crop, resize, or annotate.`
            );
        }

        const outputBase64 = outputBuffer.toString("base64");

        // Save to captures dir
        const captureDir = ensureCaptureDir();
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const labelSlug = args.label
          ? args.label.replace(/[^a-zA-Z0-9-_]/g, "-").toLowerCase()
          : args.operation;
        const filename = `${labelSlug}_${timestamp}.png`;
        const filepath = join(captureDir, filename);
        writeFileSync(filepath, outputBuffer);

        return [
          {
            type: "text",
            text: JSON.stringify({
              operation: args.operation,
              label: args.label ?? args.operation,
              filepath,
              outputSizeBytes: outputBuffer.length,
            }),
          },
          {
            type: "image",
            data: outputBase64,
            mimeType: "image/png",
          },
        ];
      } catch (err: any) {
        return {
          error: true,
          operation: args.operation,
          message: `Image manipulation failed: ${err.message}`,
        };
      }
    },
  },

  {
    name: "diff_screenshots",
    description:
      "Compare two images structurally using pixel-level analysis. Computes perceptual similarity, difference regions, and visual summary. Requires sharp. Useful for visual regression testing, UI QA, and screenshot comparison.",
    inputSchema: {
      type: "object",
      properties: {
        baseline: { type: "string", description: "File path to the baseline image" },
        candidate: { type: "string", description: "File path to the candidate image" },
        threshold: {
          type: "number",
          description: "Pixel difference threshold 0-255 (default: 30). Pixels differing by less than this are considered matching.",
        },
        outputPath: { type: "string", description: "Optional path to write the diff image" },
      },
      required: ["baseline", "candidate"],
    },
    handler: async (args: { baseline: string; candidate: string; threshold?: number; outputPath?: string }) => {
      const start = Date.now();
      const threshold = args.threshold ?? 30;

      let sharp: any;
      try {
        sharp = (await import("sharp")).default;
      } catch {
        return {
          error: true,
          message: "sharp is not installed. Run: npm install sharp",
          latencyMs: Date.now() - start,
        };
      }

      try {
        const fs = await import("node:fs");

        if (!fs.existsSync(args.baseline)) {
          return { error: true, message: `Baseline not found: ${args.baseline}` };
        }
        if (!fs.existsSync(args.candidate)) {
          return { error: true, message: `Candidate not found: ${args.candidate}` };
        }

        // Load both images as raw RGBA pixel buffers
        const baseImg = sharp(args.baseline);
        const candImg = sharp(args.candidate);

        const baseMeta = await baseImg.metadata();
        const candMeta = await candImg.metadata();

        // Resize candidate to match baseline dimensions for comparison
        const width = baseMeta.width!;
        const height = baseMeta.height!;

        const baseRaw = await baseImg.raw().ensureAlpha().toBuffer();
        const candRaw = await candImg.resize(width, height, { fit: "fill" }).raw().ensureAlpha().toBuffer();

        // Pixel-by-pixel comparison
        let matchingPixels = 0;
        let diffPixels = 0;
        const totalPixels = width * height;
        const diffBuffer = Buffer.alloc(totalPixels * 4);

        for (let i = 0; i < totalPixels; i++) {
          const offset = i * 4;
          const rDiff = Math.abs(baseRaw[offset] - candRaw[offset]);
          const gDiff = Math.abs(baseRaw[offset + 1] - candRaw[offset + 1]);
          const bDiff = Math.abs(baseRaw[offset + 2] - candRaw[offset + 2]);
          const maxDiff = Math.max(rDiff, gDiff, bDiff);

          if (maxDiff <= threshold) {
            matchingPixels++;
            // Dim matching pixels in diff output
            diffBuffer[offset] = baseRaw[offset] >> 1;
            diffBuffer[offset + 1] = baseRaw[offset + 1] >> 1;
            diffBuffer[offset + 2] = baseRaw[offset + 2] >> 1;
            diffBuffer[offset + 3] = 128;
          } else {
            diffPixels++;
            // Highlight differences in red
            diffBuffer[offset] = 255;
            diffBuffer[offset + 1] = 0;
            diffBuffer[offset + 2] = 0;
            diffBuffer[offset + 3] = 255;
          }
        }

        const similarity = totalPixels > 0 ? Math.round((matchingPixels / totalPixels) * 10000) / 100 : 100;

        // Optionally write diff image
        let diffWritten: string | null = null;
        if (args.outputPath) {
          try {
            const dir = (await import("node:path")).dirname(args.outputPath);
            fs.mkdirSync(dir, { recursive: true });
            await sharp(diffBuffer, { raw: { width, height, channels: 4 } })
              .png()
              .toFile(args.outputPath);
            diffWritten = args.outputPath;
          } catch (writeErr: any) {
            diffWritten = `write failed: ${writeErr.message}`;
          }
        }

        return {
          similarity,
          baseline: { width: baseMeta.width, height: baseMeta.height, format: baseMeta.format },
          candidate: { width: candMeta.width, height: candMeta.height, format: candMeta.format },
          diffPixels,
          matchingPixels,
          totalPixels,
          threshold,
          diffImage: diffWritten,
          latencyMs: Date.now() - start,
          summary: `${similarity}% similar (${diffPixels} pixels differ out of ${totalPixels})`,
        };
      } catch (err: any) {
        return {
          error: true,
          message: `Screenshot diff failed: ${err.message}`,
          latencyMs: Date.now() - start,
        };
      }
    },
  },
];
