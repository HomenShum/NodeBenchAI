#!/usr/bin/env node
/**
 * Gemini video-understanding judge for the LIVE ScratchNode chat.
 * Answers ONE question honestly: "Would this chat be good for real users today?"
 *
 * Uploads a real recording (from recordScratchnodeChatDemo.mjs) to the Gemini
 * File API, asks gemini-2.5-flash to evaluate it as a product reviewer would,
 * and prints a structured verdict. No hardcoded scores — the model scores what
 * it actually sees in the video.
 *
 * Usage:
 *   node scripts/ui/judgeScratchnodeChatVideo.mjs --video <path.webm> [--surface desktop|mobile]
 */
import { GoogleGenAI } from "@google/genai";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const getArg = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const VIDEO = getArg("--video", "");
const SURFACE = getArg("--surface", "desktop");
const MODEL = getArg("--model", "gemini-3.5-flash"); // latest Gemini 3.5 Flash (thinking model → thinkingBudget:0 set below)
if (!VIDEO || !fs.existsSync(VIDEO)) { console.error("ERR: --video <existing path> required"); process.exit(1); }

function loadKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  const envPath = path.resolve(".env.local");
  if (fs.existsSync(envPath)) {
    const m = fs.readFileSync(envPath, "utf8").match(/^GEMINI_API_KEY=(.+)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return null;
}
const KEY = loadKey();
if (!KEY) { console.error("ERR: GEMINI_API_KEY not found (env or .env.local)"); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROMPT = `You are a senior product designer reviewing a screen recording of a LIVE web product before launch.
This is "ScratchNode" — a live-event Q&A room: attendees chat, and "/ask" returns sourced AI answers. You are looking at the ${SURFACE.toUpperCase()} view.

Judge ONLY what you can see in the video. Do not assume features you cannot observe. Be a tough but fair reviewer — the question that matters is: "Would this be good for REAL users today?"

Score each dimension 0-10 (10 = best-in-class, comparable to Slack/Discord/Linear):
- visual_clarity: is text readable, is contrast sufficient, are elements sharp
- hierarchy: are author avatars, names, timestamps, and message bodies clearly distinguished
- chat_convention: does it read like a real chat app (per-author avatars, grouped consecutive messages, a clear composer)${SURFACE === "mobile" ? "; on MOBILE the message input/composer should be pinned to the BOTTOM of the screen" : ""}
- ${SURFACE === "mobile" ? "mobile_usability: composer reachable at the bottom, no horizontal overflow, touch targets large enough, text not cramped" : "information_density: balanced — informative without overwhelming"}
- professionalism: does it feel like a finished product vs an unpolished prototype

Return ONLY JSON:
{
  "surface": "${SURFACE}",
  "dimensions": { "visual_clarity": {"score": n, "note": "..."}, "hierarchy": {"score": n, "note": "..."}, "chat_convention": {"score": n, "note": "..."}, "${SURFACE === "mobile" ? "mobile_usability" : "information_density"}": {"score": n, "note": "..."}, "professionalism": {"score": n, "note": "..."} },
  "readiness_score": n,            // 0-100 overall, weighted by your judgment
  "verdict": "good_for_users" | "minor_polish_then_ship" | "needs_work",
  "strengths": ["...", "..."],     // concrete things you SAW that work
  "issues": ["...", "..."],        // concrete problems you SAW, ordered by severity (empty array if none)
  "one_line": "single honest sentence a founder could quote"
}`;

(async () => {
  const ai = new GoogleGenAI({ apiKey: KEY });
  let fileName = null;
  try {
    const up = await ai.files.upload({ file: VIDEO, config: { mimeType: "video/webm" } });
    fileName = up.name;
    // Poll until ACTIVE (bounded — fail honestly if it never processes).
    let file = await ai.files.get({ name: fileName });
    for (let i = 0; i < 40 && file.state === "PROCESSING"; i++) { await sleep(3000); file = await ai.files.get({ name: fileName }); }
    if (file.state !== "ACTIVE") throw new Error(`upload not ACTIVE (state=${file.state}) after polling`);

    const result = await ai.models.generateContent({
      model: MODEL,
      contents: [{ role: "user", parts: [{ fileData: { fileUri: file.uri, mimeType: "video/webm" } }, { text: PROMPT }] }],
      config: { responseMimeType: "application/json", temperature: 0.2, maxOutputTokens: 3500, thinkingConfig: { thinkingBudget: 0 } },
    });
    const text = (result.text || "").trim();
    let parsed;
    try { parsed = JSON.parse(text); } catch { throw new Error("Gemini returned non-JSON: " + text.slice(0, 300)); }
    console.log(JSON.stringify({ video: path.basename(VIDEO), model: MODEL, ...parsed }, null, 2));
  } finally {
    if (fileName) { try { await ai.files.delete({ name: fileName }); } catch { /* best-effort cleanup */ } }
  }
})().catch((e) => { console.error("JUDGE_FAILED:", e && e.message); process.exit(1); });
