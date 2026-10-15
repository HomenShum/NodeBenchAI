// @vitest-environment node
/**
 * Request-shape test for the ScratchNode video judge (SPEC-v9 A.0.6, s1.3). The judge talks to
 * a Gemini 3.x model, where sampling (`temperature`/`topP`/`topK`) is deprecated: ignored today,
 * a 400 later. Persona: a maintainer running the judge on a recording; what the script sends is
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

  it("sends thinkingLevel low and no sampling keys", async () => {
    await import("../ui/judgeScratchnodeChatVideo.mjs");
    await vi.waitFor(() => expect(generateContent).toHaveBeenCalledTimes(1));
    const request = generateContent.mock.calls[0][0];
    expect(request.model).toBe("gemini-3.5-flash");
    for (const key of ["temperature", "topP", "topK", "top_p", "top_k"]) {
      expect(request.config, key).not.toHaveProperty(key);
    }
    expect(request.config.thinkingConfig).toEqual({ thinkingLevel: "low" });
    expect(request.config.maxOutputTokens).toBe(3500);
    // A model-turn prefill is a 400 on Gemini 3.x: the conversation ends on a user turn.
    expect(request.contents.at(-1).role).toBe("user");
  });
});
