# Demo Video Quality Loop

Autonomous self-improving pipeline for creating top-market demo videos using Remotion + Gemini video understanding.

## When to use

- User says "improve the demo video", "run the video loop", "judge the video"
- After rendering a new version of the demo video
- When targeting a specific quality grade (S/A/B/C)
- When preparing for a launch, demo day, or investor meeting

## Architecture

```
Storyboard (storyboard.ts)
    |
    v
Remotion Renderer (SceneView.tsx + NodeBenchDemo.tsx)
    |
    v
MP4 Output (out/nodebench-demo-v2.mp4)
    |
    v
Gemini Video Understanding Judge (scripts/judge-demo-video.ts)
    |
    v
10-Dimension Score + Actionable Suggestions
    |
    v
Fix storyboard/renderer based on suggestions
    |
    v
Re-render → Re-judge → Loop until target grade
```

## The 10 Scoring Dimensions

| Dimension | What it measures | Weight |
|-----------|-----------------|--------|
| **Pacing** | Scene duration feel, momentum, energy curve | High |
| **Visual Clarity** | Text readability, element sharpness, contrast | High |
| **Info Density** | Balance of detail vs. overwhelm per scene | Medium |
| **Transitions** | Smoothness, variety, content-appropriate cuts | Medium |
| **Narration Sync** | Voice-visual alignment, timing of highlights | High |
| **Interactions** | Cursor naturalness, streaming text, wipes, zooms | High |
| **Montage** | Rapid-cut energy, label readability, breadth coverage | Medium |
| **Opening Hook** | First 5 seconds grab attention, "wow" factor | Critical |
| **Emotional Arc** | Build-up, hero moment, crescendo, resolution | High |
| **Call to Action** | Clear next step, memorable stats, URL visible | Medium |

## Grade Scale

| Score | Grade | Meaning |
|-------|-------|---------|
| 90-100 | S | Viral-quality. Screenshot-worthy. Would trend on Twitter. |
| 80-89 | A | Professional. Comparable to Linear/Cursor/Arc demos. |
| 70-79 | B+ | Good but missing energy or hook. Needs polish. |
| 60-69 | B | Functional demo. Won't inspire sharing. |
| 50-59 | C | Below market standard. Needs structural rework. |
| <50 | D/F | Fundamentally broken. Start over. |

## Process Flow

### Phase 1: Render the Video

```bash
cd public/proto/demo-video
npx remotion render src/Root.tsx NodeBenchDemo out/nodebench-demo-v2.mp4 \
  --codec h264 --crf 18
```

Key files:
- `public/proto/demo-video/src/storyboard.ts` — Scene definitions, timings, interactions
- `public/proto/demo-video/src/components/SceneView.tsx` — Renderer with 6 sub-components
- `public/proto/demo-video/src/compositions/NodeBenchDemo.tsx` — Remotion composition wrapper
- `public/proto/demo-video/public/screenshots/` — 14 source screenshots
- `public/proto/demo-video/public/audio/` — 15 TTS narration files

### Phase 2: Run the Judge

```bash
npx tsx scripts/judge-demo-video.ts --video public/proto/demo-video/out/nodebench-demo-v2.mp4
```

What happens:
1. Uploads MP4 to Gemini File API (temporary, auto-deleted after)
2. Sends video + storyboard context to Gemini 2.5 Flash
3. Receives structured 10-dimension evaluation
4. Saves to `public/proto/demo-video/out/judge-history.json`
5. Prints colored terminal report with bars, issues, suggestions

CLI flags:
- `--video <path>` — Judge a specific file (default: latest render)
- `--loop <N>` — Run N improvement iterations automatically
- `--history` — Show score history and trend analysis

### Phase 3: Diagnose and Fix

Priority order for fixes (highest impact first):

1. **Opening Hook (6/10)** — This is the #1 lever. First 5 seconds determine if viewer stays.
   - Fix: Start with an impactful visual before the logo
   - Fix: Show a "before/after" or a key insight immediately
   - Fix: Use a provocative question or stat as the hook

2. **Pacing (7/10)** — Hero scenes linger too long on static screens.
   - Fix: Reduce hero scene durations by 0.5-1s each
   - Fix: Add more dynamic highlights (zoom-to-element, cursor movement)
   - Fix: Increase cut frequency in early scenes

3. **Emotional Arc (7/10)** — No clear crescendo or "hero moment."
   - Fix: Identify the single most impressive feature and give it dramatic treatment
   - Fix: Build tension → reveal → resolution across the video
   - Fix: Use music/sound design to support the arc (future enhancement)

4. **Interaction Quality** — Make cursor and streaming effects more polished.
   - Fix: Smoother wipe transitions (especially dark/light theme switch)
   - Fix: More natural cursor easing curves
   - Fix: Add subtle click feedback animations

### Phase 4: Re-render and Re-judge

After fixes:
```bash
# Re-render
cd public/proto/demo-video
npx remotion render src/Root.tsx NodeBenchDemo out/nodebench-demo-v2.mp4 --codec h264 --crf 18

# Re-judge
npx tsx scripts/judge-demo-video.ts
```

Compare scores. If overall improved AND no dimension regressed > 1 point, the fix is good.
If any dimension regressed > 1 point, revert that specific change.

### Phase 5: Loop Until Target

```
while overallScore < 90:
    1. Read judge-history.json — identify lowest-scoring dimension
    2. Apply targeted fix to storyboard.ts or SceneView.tsx
    3. Re-render video
    4. Re-judge
    5. If 3 consecutive rounds without improvement → change strategy
    6. If plateau detected → try structural changes (scene reordering, new screenshots, new narration)
```

## Scene Types and Their Levers

### Intro/Outro (tier: "intro"/"outro")
- Duration: 3-5 seconds
- Levers: title animation speed, tagline timing, logo reveal style, background motion

### Hero Scenes (tier: "hero")
- Duration: 6-8 seconds
- Levers: zoomTo regions, cursorPath keyframes, highlightBoxes, streamingText
- These carry the narrative weight — every frame must communicate

### Supporting Scenes (tier: "supporting")
- Duration: 3-5 seconds
- Levers: single highlight focus, quick zoom, clean cut
- Show breadth without lingering

### Montage Scenes (tier: "montage")
- Duration: 8-10 seconds total, 1.5-2.5s per cut
- Levers: montageItems array, label positioning, cut rhythm
- Energy builders — faster = more impressive

## Interaction Components Reference

| Component | Storyboard field | What it does |
|-----------|-----------------|--------------|
| ZoomTo | `zoomTo: { x, y, scale, startFrame, holdFrames }` | Camera zoom to UI region |
| CursorOverlay | `cursorPath: [{ x, y, frame, click? }]` | Animated cursor with click ripples |
| StreamingText | `streamingText: { text, x, y, w, startFrame, charsPerFrame, style }` | Char-by-char text reveal |
| WipeTransition | `wipe: { afterScreenshot, startFrame, durationFrames, direction }` | Before/after reveal |
| MontageRenderer | `montageItems: [{ screenshot, label, durationFraction }]` | Rapid sequential cuts |
| HighlightBox | `highlightBoxes: [{ x, y, w, h, label, delayFrames }]` | Pulsing UI highlight |

## TTS Regeneration

When narration text changes:
```bash
cd public/proto/demo-video
# Delete the specific audio file to regenerate
rm public/audio/scene-id.mp3
python generate-tts.py
```

Voice: `en-US-GuyNeural`, rate: `+5%`, engine: edge-tts (free, neural)

## Reference Demos (benchmark targets)

| Demo | Key Strength | Score Target |
|------|-------------|--------------|
| Linear | Speed IS the demo. Sub-50ms feels fast. | Pacing: 9+ |
| Cursor | Real coding, split-screen, process visible | Interactions: 9+ |
| Arc Browser | Personality + rapid montages + playful | Montage: 9+, Hook: 9+ |
| Figma Config | Product speaks for itself, clean showcases | Visual Clarity: 9+ |
| Claude Code | Split-screen terminal + output | Info Density: 9+ |

## Gemini API Details

- Model: `gemini-2.5-flash` (primary), `gemini-2.5-pro` (fallback)
- API: `@google/genai` SDK v1.47.0
- File API: upload → poll until ACTIVE → generateContent with fileData → cleanup
- Response: structured JSON via `responseMimeType: "application/json"`
- Cost: ~$0.02-0.05 per judge run (Flash), ~$0.15-0.30 (Pro)

## Key Files

| File | Purpose |
|------|---------|
| `scripts/judge-demo-video.ts` | Gemini video judge CLI |
| `public/proto/demo-video/src/storyboard.ts` | Scene definitions + interactions |
| `public/proto/demo-video/src/components/SceneView.tsx` | Remotion renderer |
| `public/proto/demo-video/src/compositions/NodeBenchDemo.tsx` | Composition wrapper |
| `public/proto/demo-video/generate-tts.py` | TTS audio generation |
| `public/proto/demo-video/out/judge-history.json` | Score history |
| `public/proto/demo-video/public/screenshots/` | Source screenshots |
| `public/proto/demo-video/public/audio/` | TTS audio files |

## Anti-patterns

- Inflating scores by weakening the judge prompt
- Removing dimensions to hide weaknesses
- Optimizing for Gemini's preferences instead of human viewer experience
- Changing narration text without regenerating TTS
- Adding complexity without verifying it renders correctly via stills
- Skipping the re-render step (judging old video with new storyboard)

## Plateau Breaking Strategies

If stuck at a score for 3+ rounds:

1. **New screenshots** — Capture better source material with more dynamic UI states
2. **Scene reordering** — Put the most impressive feature first, not chronologically
3. **Narration rewrite** — More energetic, shorter sentences, action verbs
4. **New interaction types** — Add split-screen, picture-in-picture, or particle effects
5. **Sound design** — Add subtle UI sounds, typing clicks, notification chimes
6. **Structural change** — Start with problem then solution instead of feature tour

## Proven Breakthrough: Narration Restructuring (Round 5, 78 to 93)

The single biggest improvement came from **rewriting narration to frame a story, not list features**.
This broke a 4-round plateau at 78-79 and jumped to 93 (Grade S).

### What changed:

| Scene | Before (feature tour) | After (problem-solution story) |
|-------|-----------------------|-------------------------------|
| Intro | "NodeBench. Operating intelligence for agent-native businesses." | "Every morning, founders face the same question: what changed while I slept? NodeBench answers it." |
| Daily Brief | "Entity cards show live status..." | "No tabs to check. No feeds to scroll. Entity cards show live status..." |
| Chat Streaming | "The Coverage Agent streams analysis..." | "This is the moment. The Coverage Agent streams analysis in real time." |
| Outro | "Founder-grade operating intelligence." | "This is what operating intelligence looks like. Try it at nodebenchai.com." |

### Why it works:
- **Problem framing** in the intro creates immediate relatability (Hook score: 5 to 9)
- **Negation pairs** ("No tabs. No feeds.") create contrast that makes the solution feel valuable
- **"This is the moment"** signals the hero beat, priming the viewer for the wow (Arc score: 7 to 9)
- **Direct CTA** ("Try it at") converts curiosity to action (CTA score: 8 to 9)

### Gemini judge variance note:
The same video scored 93 and 81 on back-to-back runs (same model, same video).
True score is the midpoint (~87). The dimension-level trends are more reliable than
the overall score. Track P1 dimensions (those stuck at 7) rather than overall score.

## Run History (2026-05-19, 6 rounds)

| Run | Score | Grade | Key Changes | Breakthrough? |
|-----|-------|-------|-------------|---------------|
| 1 | 78 | A | Baseline v2 render | - |
| 2 | 79 | A | Tightened pacing (8s to 7s hero scenes) | Pacing: 7 to 8 |
| 3 | 78 | A | Rapid-fire cold open intro | Hook: 5 to 7 |
| 4 | 78 | A | Labeled intro montage, deeper hero zoom | Plateau |
| 5 | 93 | S | Narration rewrite + TTS regen + slower montages | ALL dimensions up |
| 6 | 81 | A | Confirmation run (same video) | Variance check |
