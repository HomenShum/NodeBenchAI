// @vitest-environment node
/**
 * Request-shape test for the ScratchNode video judge (SPEC-v9 A.0.6, s1.3). The judge talks to
 * a Gemini 3.x model; sampling (`temperature`/`topP`/`topK`) is deprecated on gemini-3.8-flash / 3.6-flash /
 * 3.5-flash-lite (s1.3): ignored today, a 400 later. Persona: a maintainer running the judge on a recording; what the script sends is
 * what Google accepts. The script runs on import, so this drives it for real with a fake
 * `@google/genai` client and asserts the outgoing `generateContent` request. No network, no spend.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generateContent = vi.hoisted(() => vi.fn());
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    files = {
      upload: async () => ({ name: "files/1" }),
      get: async () => ({ state: "ACTIVE", uri: "https://files/1" }),
      delete: async () => undefined,
    };
    models = { generateContent };
  },
}));

describe("judgeScratchnodeChatVideo.mjs Gemini request", () => {
  let video: string;
  beforeEach(() => {
    video = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "judge-")), "clip.webm");
    fs.writeFileSync(video, "not a real video");
    vi.stubEnv("GEMINI_API_KEY", "test-key-not-real");
    vi.spyOn(process, "argv", "get").mockReturnValue(["node", "judge.mjs", "--video", video]);
    vi.spyOn(console, "log").mockImplementation(() => {});
    generateContent.mockReset();
    generateContent.mockResolvedValue({ text: '{"readiness_score": 70}' });
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  // Persona: a maintainer judges a recording with --model <id>. Request shapes are keyed by the EXACT id
  // (s1.3): thinkingLevel is a Gemini 3 field (2.5 documents thinkingBudget, which main sent; PR #662 round 6, P2),
  // and temperature is dropped only for the three ids s1.3 lists as deprecated. The default gemini-3.5-flash and
  // gemini-3.1-pro-preview keep the 0.2 main sent (PR #662 round 8, P2: a gemini-3* prefix rule had dropped it).
  // Fake client: not observed at Google.
  const NO_TEMPERATURE = new Set(["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite"]);
  for (const [model, want] of [
    ["gemini-2.5-flash", { thinkingBudget: 0 }],
    ["gemini-3.5-flash", { thinkingLevel: "low" }],
    ["gemini-3.1-pro-preview", { thinkingLevel: "low" }],
    ["gemini-3.8-flash", { thinkingLevel: "low" }],
    ["gemini-3.6-flash", { thinkingLevel: "low" }],
    ["gemini-3.5-flash-lite", { thinkingLevel: "low" }],
  ] as const) {
    it(`--model ${model} sends ${JSON.stringify(want)} and ${NO_TEMPERATURE.has(model) ? "no temperature" : "temperature 0.2"}`, async () => {
      vi.spyOn(process, "argv", "get").mockReturnValue(["node", "judge.mjs", "--video", video, "--model", model]);
      await import("../ui/judgeScratchnodeChatVideo.mjs");
      await vi.waitFor(() => expect(generateContent).toHaveBeenCalledTimes(1));
      const request = generateContent.mock.calls[0][0];
      expect(request.model).toBe(model);
      expect(request.config.thinkingConfig).toEqual(want);
      if (NO_TEMPERATURE.has(model)) expect(request.config).not.toHaveProperty("temperature");
      else expect(request.config.temperature).toBe(0.2);
      for (const key of ["topP", "topK", "top_p", "top_k"]) expect(request.config, key).not.toHaveProperty(key);
    });
  }

  it("the default model sends thinkingLevel low and temperature 0.2", async () => {
    await import("../ui/judgeScratchnodeChatVideo.mjs");
    await vi.waitFor(() => expect(generateContent).toHaveBeenCalledTimes(1));
    const request = generateContent.mock.calls[0][0];
    expect(request.model).toBe("gemini-3.5-flash");
    // was: no `temperature` at all, from a gemini-3* prefix rule; s1.3 deprecates it only for 3.8-flash / 3.6-flash / 3.5-flash-lite
    expect(request.config.temperature).toBe(0.2);
    for (const key of ["topP", "topK", "top_p", "top_k"]) {
      expect(request.config, key).not.toHaveProperty(key);
    }
    expect(request.config.thinkingConfig).toEqual({ thinkingLevel: "low" });
    expect(request.config.maxOutputTokens).toBe(3500);
    // A model-turn prefill is a 400 on Gemini 3.x: the conversation ends on a user turn.
    expect(request.contents.at(-1).role).toBe("user");
  });
});
