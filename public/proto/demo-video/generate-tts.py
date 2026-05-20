"""
Generate TTS audio for NodeBench demo video v2 (condensed 15-scene storyboard).
Uses edge-tts (Microsoft Edge TTS) for cross-platform neural voice.

Usage:
  pip install edge-tts
  python generate-tts.py
"""
import asyncio
import json
import os
import sys
import io

# Force UTF-8 stdout on Windows
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

# v2 scene narrations — must match storyboard.ts scene IDs exactly
SCENES = [
    ("intro",
     "Every morning, founders face the same question: what changed while I slept? NodeBench answers it. Operating intelligence, before you ask."),

    ("daily-brief",
     "Your morning starts here. No tabs to check. No feeds to scroll. Entity cards show live status with verification badges. The Need-to-Know feed surfaces verified signals with evidence and your personal exposure context."),

    ("evidence-zoom",
     "Click any verification badge for the full evidence breakdown. Six boolean checks per claim: government source, corroborated, hard numbers, recent data, named analyst, falsifiable."),

    ("intelligence-feed",
     "What Changed cards show magnitude and citations. WHY NOW scores competing narratives with evidence checks. Five of six confidence versus three of six. Decision triggers with dates."),

    ("chat-streaming",
     "This is the moment. The Coverage Agent streams analysis in real time. Tool badges trace every step. Entity diff. Signal extract. Web search. You see exactly what the agent found and how it found it."),

    ("graph-topology",
     "Your report library as an interactive graph. Force-directed layout. Node size reflects source count, edge thickness shows connection strength. Four topology modes."),

    ("reports-gallery",
     "Eighty-seven reports, three hundred twelve sources. Gallery cards with status badges. The Entity Agent verifies claims in real time."),

    ("inbox-triage",
     "Signal triage in three priority lanes. Must Clear, Prep, and Batch. Every signal pre-classified for action."),

    ("me-identity",
     "USER dot M-D defines who you are. Decision style, voice, watchlist, competitors. Every agent and report adapts to you."),

    ("entity-interactions",
     "Click any entity for a rich popover. They stack. At-mentions, tags, and backlinks. Full bidirectional entity graph."),

    ("command-center",
     "Briefing agent in the right rail. Action cards for triage. Command K for instant search across everything."),

    ("montage-surfaces",
     "Five surfaces. Home. Reports. Chat. Inbox. Me. One click, zero page reload. Each with its own left rail, center pane, and right rail."),

    ("montage-views",
     "Four view modes. Gallery for browsing. Board for triage. Table for data. Graph for connections. Each serves a different workflow."),

    ("montage-design",
     "Full dark and light themes via one hundred seventy-nine CSS tokens. Wide mode for density. Mobile responsive at three ninety pixels. Keyboard accessible. Print optimized. No hardcoded colors."),

    ("outro",
     "NodeBench. Five surfaces. Four views. Eighty-seven reports. Three hundred twelve sources. This is what operating intelligence looks like. Try it at nodebenchai.com."),
]

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "public", "audio")

async def generate_edge_tts():
    """Generate TTS using edge-tts (Microsoft Edge, free, high quality)."""
    try:
        import edge_tts
    except ImportError:
        print("Installing edge-tts...")
        os.system(f"{sys.executable} -m pip install edge-tts")
        import edge_tts

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # Professional male voice — good for product demos
    VOICE = "en-US-GuyNeural"

    for scene_id, text in SCENES:
        final_path = os.path.join(OUTPUT_DIR, f"{scene_id}.mp3")
        if os.path.exists(final_path):
            print(f"  [skip] {scene_id}.mp3 (exists)")
            continue

        print(f"  [gen] {scene_id}.mp3 ...")
        communicate = edge_tts.Communicate(text, VOICE, rate="+5%")
        await communicate.save(final_path)
        print(f"  [ok] {scene_id}.mp3")

    print(f"\n[done] Generated {len(SCENES)} audio files in {OUTPUT_DIR}")


async def main():
    print("NodeBench Demo Video v2 — TTS Generation")
    print(f"Scenes: {len(SCENES)}")
    print(f"Output: {OUTPUT_DIR}\n")
    print("Using edge-tts (Microsoft Edge Neural TTS)\n")
    await generate_edge_tts()


if __name__ == "__main__":
    asyncio.run(main())
