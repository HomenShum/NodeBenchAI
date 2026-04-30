/**
 * TOON Format Tools — Token-Oriented Object Notation
 *
 * TOON is a serialization format optimized for LLM token efficiency (~40% fewer
 * tokens than JSON) with better accuracy (73.9% vs 69.7% on benchmarks).
 * It combines YAML-style indentation for objects with CSV-style tabular arrays.
 *
 * These tools let agents manually encode/decode TOON when needed.
 * The `--toon` CLI flag auto-converts all tool responses to TOON.
 *
 * Spec: https://github.com/toon-format/toon
 * SDK:  https://www.npmjs.com/package/@toon-format/toon
 */

import type { McpTool } from "../types.js";
import { decodeToon, encodeToon } from "./toonCodec.js";

export const toonTools: McpTool[] = [
  {
    name: "toon_encode",
    description:
      "Convert JSON data to TOON (Token-Oriented Object Notation) format. TOON uses ~40% fewer tokens than JSON while maintaining better LLM accuracy (73.9% vs 69.7%). Useful for preparing data for other LLM calls, reducing context window usage, or optimizing multi-agent handoffs. Uniform object arrays become compact CSV-style tables.",
    inputSchema: {
      type: "object",
      properties: {
        data: {
          description:
            "The JSON data to encode. Can be any valid JSON value: object, array, string, number, boolean, null.",
        },
        jsonString: {
          type: "string",
          description:
            "Alternative: pass raw JSON string to encode (useful when data is already serialized). If both data and jsonString are provided, data takes precedence.",
        },
      },
    },
    handler: async (args) => {
      let input: unknown;

      if (args.data !== undefined) {
        input = args.data;
      } else if (args.jsonString) {
        try {
          input = JSON.parse(args.jsonString);
        } catch (e: any) {
          return { error: true, message: `Invalid JSON string: ${e.message}` };
        }
      } else {
        return { error: true, message: "Provide either 'data' or 'jsonString' to encode." };
      }

      try {
        const toonString = await encodeToon(input);
        const jsonSize = JSON.stringify(input).length;
        const toonSize = toonString.length;
        const savings = Math.round((1 - toonSize / jsonSize) * 100);

        return {
          toon: toonString,
          stats: {
            jsonChars: jsonSize,
            toonChars: toonSize,
            charSavingsPercent: savings,
            estimatedTokenSavings: `~${Math.round(savings * 0.9)}%`,
          },
        };
      } catch (e: any) {
        return { error: true, message: `TOON encode failed: ${e.message}` };
      }
    },
  },

  {
    name: "toon_decode",
    description:
      "Convert TOON (Token-Oriented Object Notation) string back to JSON. Use this to parse TOON-encoded data from other agents, tool responses with --toon flag, or any TOON-formatted content. Returns standard JSON that can be used with any tool.",
    inputSchema: {
      type: "object",
      properties: {
        toon: {
          type: "string",
          description: "The TOON-formatted string to decode back to JSON.",
        },
      },
      required: ["toon"],
    },
    handler: async (args) => {
      if (!args.toon || typeof args.toon !== "string") {
        return { error: true, message: "Provide a 'toon' string to decode." };
      }

      try {
        const data = await decodeToon(args.toon);
        return { data, format: "json" };
      } catch (e: any) {
        return { error: true, message: `TOON decode failed: ${e.message}` };
      }
    },
  },
];
