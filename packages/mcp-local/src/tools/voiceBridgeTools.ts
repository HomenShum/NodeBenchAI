/**
 * Voice Bridge Tools — Knowledge-based planning tools for voice interface design.
 *
 * These are research/planning tools that help agents design, validate, scaffold,
 * and benchmark voice pipelines. They do NOT perform actual voice processing —
 * all data comes from built-in knowledge bases of STT/TTS/LLM latency and cost.
 *
 * 4 tools:
 * - design_voice_pipeline: Recommend optimal STT/TTS/LLM stack for requirements
 * - analyze_voice_config: Validate a pipeline config for compatibility and cost
 * - generate_voice_scaffold: Generate starter code for a voice bridge
 * - benchmark_voice_latency: Calculate theoretical latency for pipeline configs
 */

import type { McpTool } from "../types.js";

// ─── Knowledge Base: STT engines ─────────────────────────────────────────────

interface SttEngine {
  name: string;
  key: string;
  latencyMs: number;
  costPerMin: number;
  privacy: "local" | "cloud";
  platforms: string[];
  quality: "high" | "medium" | "low";
  streaming: boolean;
  notes: string;
}

const STT_ENGINES: SttEngine[] = [
  {
    name: "Whisper (OpenAI, local)",
    key: "whisper",
    latencyMs: 2000,
    costPerMin: 0,
    privacy: "local",
    platforms: ["mac", "windows", "linux"],
    quality: "high",
    streaming: false,
    notes: "Runs locally via whisper.cpp or Python. 1-3s latency depending on model size and hardware.",
  },
  {
    name: "Whisper MLX (Apple Silicon)",
    key: "whisper_mlx",
    latencyMs: 800,
    costPerMin: 0,
    privacy: "local",
    platforms: ["mac"],
    quality: "high",
    streaming: false,
    notes: "Optimized for Apple M-series chips via MLX framework. Significantly faster than CPU Whisper.",
  },
  {
    name: "Deepgram",
    key: "deepgram",
    latencyMs: 300,
    costPerMin: 0.0043,
    privacy: "cloud",
    platforms: ["mac", "windows", "linux", "browser", "mobile"],
    quality: "high",
    streaming: true,
    notes: "Cloud STT with very low latency. WebSocket streaming. $0.0043/min (Nova-2).",
  },
  {
    name: "Google Cloud Speech-to-Text",
    key: "google_speech",
    latencyMs: 500,
    costPerMin: 0.006,
    privacy: "cloud",
    platforms: ["mac", "windows", "linux", "browser", "mobile"],
    quality: "high",
    streaming: true,
    notes: "Mature cloud STT. $0.006/min standard, $0.009/min enhanced. Good multilingual support.",
  },
  {
    name: "Web Speech API (browser)",
    key: "web_speech_api_stt",
    latencyMs: 500,
    costPerMin: 0,
    privacy: "cloud",
    platforms: ["browser"],
    quality: "medium",
    streaming: true,
    notes: "Free browser-native STT. Uses device/OS speech engine. Chrome uses Google, Safari uses Apple. Not available in Node.js.",
  },
];

// ─── Knowledge Base: TTS engines ─────────────────────────────────────────────

interface TtsEngine {
  name: string;
  key: string;
  latencyMs: number;
  costPerMin: number;
  privacy: "local" | "cloud";
  platforms: string[];
  quality: "high" | "medium" | "low";
  streaming: boolean;
  notes: string;
}

const TTS_ENGINES: TtsEngine[] = [
  {
    name: "Edge TTS (Microsoft)",
    key: "edge_tts",
    latencyMs: 500,
    costPerMin: 0,
    privacy: "cloud",
    platforms: ["mac", "windows", "linux"],
    quality: "high",
    streaming: true,
    notes: "Free cloud TTS via edge-tts Python package. High quality voices, ~0.5s TTFB. May have rate limits.",
  },
  {
    name: "Cartesia Sonic",
    key: "cartesia",
    latencyMs: 100,
    costPerMin: 0.042,
    privacy: "cloud",
    platforms: ["mac", "windows", "linux", "browser", "mobile"],
    quality: "high",
    streaming: true,
    notes: "Ultra-low latency streaming TTS. ~100ms TTFB. $0.042/min. Best for real-time voice agents.",
  },
  {
    name: "ElevenLabs",
    key: "elevenlabs",
    latencyMs: 1000,
    costPerMin: 0.18,
    privacy: "cloud",
    platforms: ["mac", "windows", "linux", "browser", "mobile"],
    quality: "high",
    streaming: true,
    notes: "Highest quality voice cloning and synthesis. ~1s TTFB. Expensive ($0.18/min). Best for pre-generated content.",
  },
  {
    name: "macOS say",
    key: "macos_say",
    latencyMs: 50,
    costPerMin: 0,
    privacy: "local",
    platforms: ["mac"],
    quality: "medium",
    streaming: false,
    notes: "Built-in macOS speech synthesis. Instant, free, fully local. Limited voice quality.",
  },
  {
    name: "Piper TTS",
    key: "piper",
    latencyMs: 200,
    costPerMin: 0,
    privacy: "local",
    platforms: ["mac", "windows", "linux"],
    quality: "medium",
    streaming: false,
    notes: "Fast local neural TTS. ONNX-based, runs on CPU. Good quality for a local engine. ~200ms.",
  },
  {
    name: "Browser speechSynthesis",
    key: "web_speech_api_tts",
    latencyMs: 100,
    costPerMin: 0,
    privacy: "local",
    platforms: ["browser"],
    quality: "low",
    streaming: false,
    notes: "Free browser-native TTS. Uses OS voices. Quality varies by platform. Not available in Node.js.",
  },
];

// ─── Knowledge Base: LLM engines ─────────────────────────────────────────────

interface LlmEngine {
  name: string;
  key: string;
  firstTokenMs: number;
  tokensPerSec: number;
  costPer1kTokens: number;
  privacy: "local" | "cloud";
  quality: "high" | "medium";
  notes: string;
}

const LLM_ENGINES: LlmEngine[] = [
  {
    name: "Claude Haiku 4.5",
    key: "claude_haiku_4_5",
    firstTokenMs: 300,
    tokensPerSec: 120,
    costPer1kTokens: 0.00025,
    privacy: "cloud",
    quality: "medium",
    notes: "Fastest Claude model. Good for voice where speed matters. ~300ms TTFT.",
  },
  {
    name: "GPT-5-mini",
    key: "gpt5_mini",
    firstTokenMs: 400,
    tokensPerSec: 100,
    costPer1kTokens: 0.00015,
    privacy: "cloud",
    quality: "medium",
    notes: "Fast and cheap. ~400ms TTFT. Good for simple voice interactions.",
  },
  {
    name: "Local Llama (llama.cpp)",
    key: "local_llama",
    firstTokenMs: 1000,
    tokensPerSec: 30,
    costPer1kTokens: 0,
    privacy: "local",
    quality: "medium",
    notes: "Fully private, runs on consumer hardware. 2-5s for first response depending on model/hardware. Slower but free.",
  },
];

// ─── Helper functions ────────────────────────────────────────────────────────

function findStt(key: string): SttEngine | undefined {
  return STT_ENGINES.find((e) => e.key === key || e.name.toLowerCase().includes(key.toLowerCase()));
}

function findTts(key: string): TtsEngine | undefined {
  return TTS_ENGINES.find((e) => e.key === key || e.name.toLowerCase().includes(key.toLowerCase()));
}

function findLlm(key: string): LlmEngine | undefined {
  return LLM_ENGINES.find((e) => e.key === key || e.name.toLowerCase().includes(key.toLowerCase()));
}

function estimateRoundTrip(stt: SttEngine, tts: TtsEngine, llm: LlmEngine, streaming: boolean): {
  totalMs: number;
  perceivedMs: number;
  breakdown: { sttMs: number; llmFirstTokenMs: number; llmCompletionMs: number; ttsMs: number };
} {
  const avgResponseTokens = 60;
  const llmCompletionMs = Math.round((avgResponseTokens / llm.tokensPerSec) * 1000);
  const ttsEffective = streaming && tts.streaming ? Math.round(tts.latencyMs * 0.5) : tts.latencyMs;

  const totalMs = stt.latencyMs + llm.firstTokenMs + llmCompletionMs + tts.latencyMs;
  // With streaming, user hears audio before LLM finishes
  const perceivedMs = stt.latencyMs + llm.firstTokenMs + ttsEffective;

  return {
    totalMs,
    perceivedMs,
    breakdown: {
      sttMs: stt.latencyMs,
      llmFirstTokenMs: llm.firstTokenMs,
      llmCompletionMs,
      ttsMs: tts.latencyMs,
    },
  };
}

function estimateMonthlyCost(stt: SttEngine, tts: TtsEngine, llm: LlmEngine, minutesPerDay: number): {
  monthly: number;
  breakdown: { stt: number; tts: number; llm: number };
} {
  const daysPerMonth = 30;
  const totalMinutes = minutesPerDay * daysPerMonth;
  // Assume ~150 tokens per minute of conversation (input + output)
  const tokensPerMinute = 150;

  const sttCost = stt.costPerMin * totalMinutes;
  const ttsCost = tts.costPerMin * totalMinutes;
  const llmCost = (tokensPerMinute / 1000) * llm.costPer1kTokens * totalMinutes;

  return {
    monthly: Math.round((sttCost + ttsCost + llmCost) * 100) / 100,
    breakdown: {
      stt: Math.round(sttCost * 100) / 100,
      tts: Math.round(ttsCost * 100) / 100,
      llm: Math.round(llmCost * 100) / 100,
    },
  };
}

function rateLatency(perceivedMs: number): "excellent" | "good" | "acceptable" | "poor" {
  if (perceivedMs <= 500) return "excellent";
  if (perceivedMs <= 1000) return "good";
  if (perceivedMs <= 2000) return "acceptable";
  return "poor";
}

// ─── Scaffold templates ──────────────────────────────────────────────────────

function getScaffoldWhisperEdge(includeVAD: boolean): {
  files: Array<{ path: string; content: string; description: string }>;
  setupInstructions: string[];
  dependencies: string[];
} {
  const vadCode = includeVAD
    ? `
import numpy as np

def detect_voice_activity(audio_chunk: np.ndarray, threshold: float = 0.02) -> bool:
    """Simple energy-based Voice Activity Detection."""
    energy = np.sqrt(np.mean(audio_chunk.astype(np.float32) ** 2))
    return energy > threshold
`
    : "";

  const vadImport = includeVAD ? "from vad import detect_voice_activity\n" : "";
  const vadUsage = includeVAD
    ? `
            # Check for voice activity before sending to Whisper
            if not detect_voice_activity(audio_data):
                continue`
    : "";

  return {
    files: [
      {
        path: "voice_bridge.py",
        content: `"""Voice Bridge: Whisper STT + Edge TTS + WebSocket server."""
import asyncio
import json
import tempfile
import wave
import whisper
import edge_tts
import websockets
${vadImport}
# Load Whisper model (use "tiny" or "base" for speed, "small" for accuracy)
model = whisper.load_model("base")

async def transcribe(audio_data: bytes) -> str:
    """Transcribe audio bytes using Whisper."""
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=True) as f:
        # Write raw PCM as WAV
        with wave.open(f.name, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(16000)
            wf.writeframes(audio_data)
        result = model.transcribe(f.name, language="en")
    return result["text"].strip()

async def synthesize(text: str) -> bytes:
    """Synthesize speech using Edge TTS."""
    communicate = edge_tts.Communicate(text, voice="en-US-AriaNeural")
    audio_chunks = []
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            audio_chunks.append(chunk["data"])
    return b"".join(audio_chunks)

async def handle_client(websocket):
    """Handle a WebSocket client connection."""
    print("Client connected")
    try:
        async for message in websocket:
            if isinstance(message, bytes):${vadUsage}
                # Transcribe speech to text
                transcript = await transcribe(message)
                print(f"User: {transcript}")

                # TODO: Send transcript to your LLM and get response
                llm_response = f"Echo: {transcript}"

                # Synthesize response to speech
                audio = await synthesize(llm_response)
                await websocket.send(audio)
            else:
                # Handle text/control messages
                data = json.loads(message)
                if data.get("type") == "ping":
                    await websocket.send(json.dumps({{"type": "pong"}}))
    except websockets.exceptions.ConnectionClosed:
        print("Client disconnected")

async def main():
    print("Voice Bridge starting on ws://localhost:8765")
    async with websockets.serve(handle_client, "localhost", 8765):
        await asyncio.Future()  # Run forever

if __name__ == "__main__":
    asyncio.run(main())
`,
        description: "Main voice bridge server: Whisper STT + Edge TTS over WebSocket",
      },
      ...(includeVAD
        ? [
            {
              path: "vad.py",
              content: vadCode.trim() + "\n",
              description: "Simple energy-based Voice Activity Detection",
            },
          ]
        : []),
      {
        path: "requirements.txt",
        content: `openai-whisper
edge-tts
websockets
numpy
`,
        description: "Python dependencies",
      },
    ],
    setupInstructions: [
      "pip install -r requirements.txt",
      "python voice_bridge.py",
      "Connect a WebSocket client to ws://localhost:8765",
      "Send raw PCM audio (16kHz, 16-bit, mono) as binary WebSocket frames",
      "Receive synthesized audio back as binary frames",
    ],
    dependencies: ["openai-whisper", "edge-tts", "websockets", "numpy", "ffmpeg (system)"],
  };
}

function getScaffoldDeepgramCartesia(includeVAD: boolean): {
  files: Array<{ path: string; content: string; description: string }>;
  setupInstructions: string[];
  dependencies: string[];
} {
  const vadBlock = includeVAD
    ? `
// Simple energy-based VAD
function detectVoiceActivity(samples: Float32Array, threshold = 0.02): boolean {
  let energy = 0;
  for (let i = 0; i < samples.length; i++) energy += samples[i] * samples[i];
  return Math.sqrt(energy / samples.length) > threshold;
}
`
    : "";

  return {
    files: [
      {
        path: "src/voice-bridge.ts",
        content: `/**
 * Voice Bridge: Deepgram STT + Cartesia TTS (TypeScript)
 *
 * Requires:
 *   DEEPGRAM_API_KEY — from https://console.deepgram.com
 *   CARTESIA_API_KEY — from https://play.cartesia.ai
 */
import { createClient, LiveTranscriptionEvents } from "@deepgram/sdk";
import Cartesia from "@cartesia/cartesia-js";
import { WebSocketServer } from "ws";

const deepgram = createClient(process.env.DEEPGRAM_API_KEY!);
const cartesia = new Cartesia({ apiKey: process.env.CARTESIA_API_KEY! });
${vadBlock}
const wss = new WebSocketServer({ port: 8765 });
console.log("Voice Bridge listening on ws://localhost:8765");

wss.on("connection", (ws) => {
  console.log("Client connected");

  // Set up Deepgram live transcription
  const dgConn = deepgram.listen.live({
    model: "nova-2",
    language: "en",
    smart_format: true,
    interim_results: false,
  });

  dgConn.on(LiveTranscriptionEvents.Open, () => {
    console.log("Deepgram connection open");
  });

  dgConn.on(LiveTranscriptionEvents.Transcript, async (data) => {
    const transcript = data.channel?.alternatives?.[0]?.transcript;
    if (!transcript) return;

    console.log(\`User: \${transcript}\`);

    // TODO: Send transcript to your LLM and get response
    const llmResponse = \`Echo: \${transcript}\`;

    // Synthesize with Cartesia (streaming)
    const ttsResponse = await cartesia.tts.sse({
      modelId: "sonic-3.6",
      transcript: llmResponse,
      voice: { mode: "id", id: "a0e99841-438c-4a64-b679-ae501e7d6091" },
      output_format: { container: "raw", encoding: "pcm_s16le", sample_rate: 24000 },
    });

    for await (const chunk of ttsResponse) {
      if (ws.readyState === ws.OPEN) {
        ws.send(chunk);
      }
    }
  });

  dgConn.on(LiveTranscriptionEvents.Error, (err) => {
    console.error("Deepgram error:", err);
  });

  ws.on("message", (data: Buffer) => {${includeVAD ? "\n    // VAD check\n    const samples = new Float32Array(data.buffer);\n    if (!detectVoiceActivity(samples)) return;\n" : ""}
    dgConn.send(data);
  });

  ws.on("close", () => {
    dgConn.finish();
    console.log("Client disconnected");
  });
});
`,
        description: "TypeScript voice bridge: Deepgram Nova-2 STT + Cartesia Sonic streaming TTS",
      },
      {
        path: "package.json",
        content: JSON.stringify(
          {
            name: "voice-bridge-deepgram-cartesia",
            type: "module",
            scripts: { start: "tsx src/voice-bridge.ts", build: "tsc" },
            dependencies: {
              "@deepgram/sdk": "^3.0.0",
              "@cartesia/cartesia-js": "^1.0.0",
              ws: "^8.0.0",
            },
            devDependencies: { typescript: "^5.7.0", tsx: "^4.0.0", "@types/ws": "^8.0.0" },
          },
          null,
          2,
        ),
        description: "Package manifest with Deepgram and Cartesia SDKs",
      },
    ],
    setupInstructions: [
      "npm install",
      "Set DEEPGRAM_API_KEY and CARTESIA_API_KEY environment variables",
      "npx tsx src/voice-bridge.ts",
      "Connect a WebSocket client to ws://localhost:8765",
      "Send raw PCM audio as binary frames, receive synthesized audio back",
    ],
    dependencies: ["@deepgram/sdk", "@cartesia/cartesia-js", "ws", "tsx"],
  };
}

function getScaffoldBrowserWebspeech(): {
  files: Array<{ path: string; content: string; description: string }>;
  setupInstructions: string[];
  dependencies: string[];
} {
  return {
    files: [
      {
        path: "index.html",
        content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Voice Bridge — Web Speech API</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 600px; margin: 2rem auto; padding: 0 1rem; }
    #status { padding: 0.5rem; border-radius: 4px; margin: 1rem 0; }
    .listening { background: #dcfce7; color: #166534; }
    .speaking { background: #dbeafe; color: #1e40af; }
    .idle { background: #f3f4f6; color: #374151; }
    #transcript { white-space: pre-wrap; border: 1px solid #d1d5db; padding: 1rem; border-radius: 4px; min-height: 200px; max-height: 400px; overflow-y: auto; }
    button { padding: 0.75rem 1.5rem; font-size: 1rem; border: none; border-radius: 4px; cursor: pointer; margin: 0.25rem; }
    #startBtn { background: #2563eb; color: white; }
    #startBtn:disabled { background: #93c5fd; cursor: not-allowed; }
    #stopBtn { background: #dc2626; color: white; }
  </style>
</head>
<body>
  <h1>Voice Bridge</h1>
  <p>Browser-native STT + TTS using the Web Speech API. No server needed.</p>
  <div>
    <button id="startBtn" onclick="startListening()">Start Listening</button>
    <button id="stopBtn" onclick="stopListening()">Stop</button>
  </div>
  <div id="status" class="idle">Idle</div>
  <div id="transcript"></div>

  <script>
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      document.getElementById("status").textContent = "Web Speech API not supported in this browser.";
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    const synth = window.speechSynthesis;
    const transcriptEl = document.getElementById("transcript");
    const statusEl = document.getElementById("status");
    let isListening = false;

    function setStatus(text, cls) {
      statusEl.textContent = text;
      statusEl.className = cls;
    }

    function appendTranscript(role, text) {
      transcriptEl.textContent += role + ": " + text + "\\n";
      transcriptEl.scrollTop = transcriptEl.scrollHeight;
    }

    recognition.onresult = (event) => {
      const last = event.results[event.results.length - 1];
      if (last.isFinal) {
        const transcript = last[0].transcript.trim();
        if (!transcript) return;

        appendTranscript("You", transcript);
        setStatus("Processing...", "speaking");

        // TODO: Send transcript to your LLM API and get response
        const llmResponse = "Echo: " + transcript;

        appendTranscript("Assistant", llmResponse);

        // Speak the response
        const utterance = new SpeechSynthesisUtterance(llmResponse);
        utterance.onstart = () => setStatus("Speaking...", "speaking");
        utterance.onend = () => setStatus("Listening...", "listening");
        synth.speak(utterance);
      }
    };

    recognition.onerror = (event) => {
      console.error("Speech recognition error:", event.error);
      if (event.error !== "no-speech") {
        setStatus("Error: " + event.error, "idle");
      }
    };

    recognition.onend = () => {
      if (isListening) recognition.start(); // Auto-restart
    };

    function startListening() {
      isListening = true;
      recognition.start();
      setStatus("Listening...", "listening");
      document.getElementById("startBtn").disabled = true;
    }

    function stopListening() {
      isListening = false;
      recognition.stop();
      synth.cancel();
      setStatus("Idle", "idle");
      document.getElementById("startBtn").disabled = false;
    }
  </script>
</body>
</html>
`,
        description: "Self-contained HTML page using Web Speech API for both STT and TTS",
      },
    ],
    setupInstructions: [
      "Open index.html in Chrome or Edge (best Web Speech API support)",
      "Click 'Start Listening' and allow microphone access",
      "Speak — your words will be transcribed and echoed back via TTS",
      "Replace the 'Echo' logic with an LLM API call for real conversations",
    ],
    dependencies: [],
  };
}

function getScaffoldWhisperPiper(includeVAD: boolean): {
  files: Array<{ path: string; content: string; description: string }>;
  setupInstructions: string[];
  dependencies: string[];
} {
  const vadCode = includeVAD
    ? `
import numpy as np

def detect_voice_activity(audio_chunk: np.ndarray, threshold: float = 0.02) -> bool:
    """Simple energy-based Voice Activity Detection."""
    energy = np.sqrt(np.mean(audio_chunk.astype(np.float32) ** 2))
    return energy > threshold
`
    : "";

  const vadImport = includeVAD ? "from vad import detect_voice_activity\n" : "";
  const vadUsage = includeVAD
    ? `
            # Check for voice activity
            if not detect_voice_activity(audio_data):
                continue`
    : "";

  return {
    files: [
      {
        path: "voice_bridge.py",
        content: `"""Fully Local Voice Bridge: Whisper STT + Piper TTS. No cloud dependencies."""
import asyncio
import json
import subprocess
import tempfile
import wave
import whisper
import websockets
${vadImport}
# Load Whisper model
model = whisper.load_model("base")

# Piper TTS configuration
PIPER_MODEL = "en_US-lessac-medium"  # Download from https://github.com/rhasspy/piper/releases
PIPER_BIN = "piper"  # Ensure piper is on PATH

async def transcribe(audio_data: bytes) -> str:
    """Transcribe audio bytes using Whisper."""
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=True) as f:
        with wave.open(f.name, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(16000)
            wf.writeframes(audio_data)
        result = model.transcribe(f.name, language="en")
    return result["text"].strip()

async def synthesize(text: str) -> bytes:
    """Synthesize speech using Piper TTS (local, ONNX-based)."""
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=True) as f:
        proc = await asyncio.create_subprocess_exec(
            PIPER_BIN,
            "--model", PIPER_MODEL,
            "--output_file", f.name,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        await proc.communicate(input=text.encode("utf-8"))
        with open(f.name, "rb") as audio:
            return audio.read()

async def handle_client(websocket):
    """Handle a WebSocket client connection."""
    print("Client connected")
    try:
        async for message in websocket:
            if isinstance(message, bytes):${vadUsage}
                transcript = await transcribe(message)
                print(f"User: {transcript}")

                # TODO: Send to local LLM (e.g. llama.cpp server)
                llm_response = f"Echo: {transcript}"

                audio = await synthesize(llm_response)
                await websocket.send(audio)
            else:
                data = json.loads(message)
                if data.get("type") == "ping":
                    await websocket.send(json.dumps({{"type": "pong"}}))
    except websockets.exceptions.ConnectionClosed:
        print("Client disconnected")

async def main():
    print("Local Voice Bridge starting on ws://localhost:8765")
    print("Fully offline — no cloud APIs used.")
    async with websockets.serve(handle_client, "localhost", 8765):
        await asyncio.Future()

if __name__ == "__main__":
    asyncio.run(main())
`,
        description: "Fully local voice bridge: Whisper + Piper (no cloud dependencies)",
      },
      ...(includeVAD
        ? [
            {
              path: "vad.py",
              content: vadCode.trim() + "\n",
              description: "Simple energy-based Voice Activity Detection",
            },
          ]
        : []),
      {
        path: "requirements.txt",
        content: `openai-whisper
websockets
numpy
`,
        description: "Python dependencies (Piper installed separately as binary)",
      },
    ],
    setupInstructions: [
      "pip install -r requirements.txt",
      "Download Piper binary from https://github.com/rhasspy/piper/releases",
      "Download a Piper voice model (e.g. en_US-lessac-medium.onnx)",
      "Ensure 'piper' is on your PATH",
      "python voice_bridge.py",
      "Connect via WebSocket at ws://localhost:8765",
    ],
    dependencies: ["openai-whisper", "websockets", "numpy", "piper (system binary)", "ffmpeg (system)"],
  };
}

function getScaffoldCustom(language: string, includeVAD: boolean): {
  files: Array<{ path: string; content: string; description: string }>;
  setupInstructions: string[];
  dependencies: string[];
} {
  if (language === "python") {
    const vadBlock = includeVAD
      ? `
class SimpleVAD:
    """Energy-based Voice Activity Detection."""
    def __init__(self, threshold: float = 0.02):
        self.threshold = threshold

    def is_speech(self, audio_chunk) -> bool:
        import numpy as np
        energy = np.sqrt(np.mean(np.frombuffer(audio_chunk, dtype=np.int16).astype(np.float32) ** 2))
        return energy > self.threshold
`
      : "";

    return {
      files: [
        {
          path: "voice_bridge.py",
          content: `"""Custom Voice Bridge Template — Plug in any STT/TTS/LLM."""
import asyncio
import json
from abc import ABC, abstractmethod
import websockets


class STTProvider(ABC):
    @abstractmethod
    async def transcribe(self, audio_data: bytes) -> str: ...

class TTSProvider(ABC):
    @abstractmethod
    async def synthesize(self, text: str) -> bytes: ...

class LLMProvider(ABC):
    @abstractmethod
    async def generate(self, prompt: str, history: list[dict]) -> str: ...
${vadBlock}

# ─── Implement your providers here ────────────────────────────────

class MySTT(STTProvider):
    async def transcribe(self, audio_data: bytes) -> str:
        # TODO: Replace with your STT implementation
        raise NotImplementedError("Implement STT provider")

class MyTTS(TTSProvider):
    async def synthesize(self, text: str) -> bytes:
        # TODO: Replace with your TTS implementation
        raise NotImplementedError("Implement TTS provider")

class MyLLM(LLMProvider):
    async def generate(self, prompt: str, history: list[dict]) -> str:
        # TODO: Replace with your LLM implementation
        return f"Echo: {prompt}"


# ─── Voice bridge server ──────────────────────────────────────────

class VoiceBridge:
    def __init__(self, stt: STTProvider, tts: TTSProvider, llm: LLMProvider):
        self.stt = stt
        self.tts = tts
        self.llm = llm

    async def handle_client(self, websocket):
        history = []
        async for message in websocket:
            if isinstance(message, bytes):
                transcript = await self.stt.transcribe(message)
                history.append({"role": "user", "content": transcript})
                response = await self.llm.generate(transcript, history)
                history.append({"role": "assistant", "content": response})
                audio = await self.tts.synthesize(response)
                await websocket.send(audio)
            else:
                data = json.loads(message)
                await websocket.send(json.dumps({"type": "pong"}))

    async def start(self, host: str = "localhost", port: int = 8765):
        print(f"Voice Bridge on ws://{host}:{port}")
        async with websockets.serve(self.handle_client, host, port):
            await asyncio.Future()


if __name__ == "__main__":
    bridge = VoiceBridge(stt=MySTT(), tts=MyTTS(), llm=MyLLM())
    asyncio.run(bridge.start())
`,
          description: "Pluggable voice bridge template with abstract STT/TTS/LLM interfaces",
        },
      ],
      setupInstructions: [
        "Implement MySTT, MyTTS, and MyLLM classes with your chosen providers",
        "pip install websockets (+ your provider SDKs)",
        "python voice_bridge.py",
      ],
      dependencies: ["websockets"],
    };
  }

  // TypeScript custom template
  const vadBlock = includeVAD
    ? `
/** Simple energy-based Voice Activity Detection. */
function detectVoiceActivity(samples: Float32Array, threshold = 0.02): boolean {
  let energy = 0;
  for (let i = 0; i < samples.length; i++) energy += samples[i] * samples[i];
  return Math.sqrt(energy / samples.length) > threshold;
}
`
    : "";

  return {
    files: [
      {
        path: "src/voice-bridge.ts",
        content: `/**
 * Custom Voice Bridge Template — Plug in any STT/TTS/LLM.
 */
import { WebSocketServer } from "ws";

// ─── Provider interfaces ─────────────────────────────────────────

interface STTProvider {
  transcribe(audio: Buffer): Promise<string>;
}

interface TTSProvider {
  synthesize(text: string): Promise<Buffer>;
}

interface LLMProvider {
  generate(prompt: string, history: Array<{ role: string; content: string }>): Promise<string>;
}
${vadBlock}
// ─── Implement your providers here ───────────────────────────────

class MySTT implements STTProvider {
  async transcribe(audio: Buffer): Promise<string> {
    // TODO: Replace with your STT implementation
    throw new Error("Implement STT provider");
  }
}

class MyTTS implements TTSProvider {
  async synthesize(text: string): Promise<Buffer> {
    // TODO: Replace with your TTS implementation
    throw new Error("Implement TTS provider");
  }
}

class MyLLM implements LLMProvider {
  async generate(prompt: string, history: Array<{ role: string; content: string }>): Promise<string> {
    // TODO: Replace with your LLM implementation
    return \`Echo: \${prompt}\`;
  }
}

// ─── Voice bridge server ─────────────────────────────────────────

const stt = new MySTT();
const tts = new MyTTS();
const llm = new MyLLM();

const wss = new WebSocketServer({ port: 8765 });
console.log("Voice Bridge listening on ws://localhost:8765");

wss.on("connection", (ws) => {
  const history: Array<{ role: string; content: string }> = [];

  ws.on("message", async (data: Buffer) => {
    try {
      const transcript = await stt.transcribe(data);
      history.push({ role: "user", content: transcript });

      const response = await llm.generate(transcript, history);
      history.push({ role: "assistant", content: response });

      const audio = await tts.synthesize(response);
      ws.send(audio);
    } catch (err) {
      console.error("Pipeline error:", err);
    }
  });
});
`,
        description: "Pluggable voice bridge template with STT/TTS/LLM interfaces",
      },
      {
        path: "package.json",
        content: JSON.stringify(
          {
            name: "voice-bridge-custom",
            type: "module",
            scripts: { start: "tsx src/voice-bridge.ts", build: "tsc" },
            dependencies: { ws: "^8.0.0" },
            devDependencies: { typescript: "^5.7.0", tsx: "^4.0.0", "@types/ws": "^8.0.0" },
          },
          null,
          2,
        ),
        description: "Package manifest — add your provider SDKs as dependencies",
      },
    ],
    setupInstructions: [
      "npm install",
      "Implement MySTT, MyTTS, and MyLLM classes with your chosen providers",
      "Add provider SDK packages to dependencies",
      "npx tsx src/voice-bridge.ts",
    ],
    dependencies: ["ws", "tsx"],
  };
}

// ─── Tools ───────────────────────────────────────────────────────────────────

export const voiceBridgeTools: McpTool[] = [
  // ─── Tool 1: design_voice_pipeline ──────────────────────────────────────────
  {
    name: "design_voice_pipeline",
    description:
      "Given requirements (latency, privacy, platform, budget), recommend an optimal STT/TTS/LLM stack. Returns top 3 configurations ranked by fit, with estimated round-trip latency, monthly cost, and architecture notes. Knowledge-based — no live measurements.",
    inputSchema: {
      type: "object",
      properties: {
        requirements: {
          type: "object",
          description: "Pipeline requirements to match against",
          properties: {
            maxLatencyMs: {
              type: "number",
              description: "Maximum acceptable round-trip latency in ms (default: 2000)",
            },
            privacy: {
              type: "string",
              enum: ["local", "cloud", "hybrid"],
              description: "Privacy requirement: 'local' (no data leaves device), 'cloud' (OK), 'hybrid' (STT/TTS local, LLM cloud)",
            },
            platform: {
              type: "string",
              enum: ["mac", "windows", "linux", "browser", "mobile"],
              description: "Target platform",
            },
            budget: {
              type: "string",
              enum: ["free", "low", "medium", "enterprise"],
              description: "Budget tier: free ($0), low (<$10/mo), medium (<$100/mo), enterprise (unlimited)",
            },
          },
        },
      },
      required: ["requirements"],
    },
    handler: async (args) => {
      const reqs = args.requirements ?? {};
      const maxLatency = reqs.maxLatencyMs ?? 2000;
      const privacy = reqs.privacy ?? "cloud";
      const platform = reqs.platform ?? "linux";
      const budget = reqs.budget ?? "medium";

      const budgetCaps: Record<string, number> = { free: 0, low: 10, medium: 100, enterprise: Infinity };
      const monthlyCap = budgetCaps[budget] ?? 100;

      // Filter compatible engines
      const filteredStt = STT_ENGINES.filter((e) => {
        if (platform && !e.platforms.includes(platform)) return false;
        if (privacy === "local" && e.privacy !== "local") return false;
        if (budget === "free" && e.costPerMin > 0) return false;
        return true;
      });

      const filteredTts = TTS_ENGINES.filter((e) => {
        if (platform && !e.platforms.includes(platform)) return false;
        if (privacy === "local" && e.privacy !== "local") return false;
        if (budget === "free" && e.costPerMin > 0) return false;
        return true;
      });

      const filteredLlm = LLM_ENGINES.filter((e) => {
        if (privacy === "local" && e.privacy !== "local") return false;
        if (budget === "free" && e.costPer1kTokens > 0) return false;
        return true;
      });

      // For hybrid privacy: allow cloud LLM but keep STT/TTS local
      const hybridLlm =
        privacy === "hybrid"
          ? LLM_ENGINES.filter((e) => budget === "free" ? e.costPer1kTokens === 0 : true)
          : filteredLlm;
      const effectiveLlm = privacy === "hybrid" ? hybridLlm : filteredLlm;

      if (filteredStt.length === 0 || filteredTts.length === 0 || effectiveLlm.length === 0) {
        return {
          error: false,
          recommended: null,
          alternatives: [],
          message: "No compatible configuration found for the given requirements. Try relaxing privacy or budget constraints.",
          availableStt: filteredStt.map((e) => e.name),
          availableTts: filteredTts.map((e) => e.name),
          availableLlm: effectiveLlm.map((e) => e.name),
          considerations: [
            filteredStt.length === 0 ? `No STT engines match platform=${platform} + privacy=${privacy}` : null,
            filteredTts.length === 0 ? `No TTS engines match platform=${platform} + privacy=${privacy}` : null,
            effectiveLlm.length === 0 ? `No LLM engines match privacy=${privacy} + budget=${budget}` : null,
          ].filter(Boolean),
        };
      }

      // Generate all valid combinations and score them
      const candidates: Array<{
        stt: SttEngine;
        tts: TtsEngine;
        llm: LlmEngine;
        latency: ReturnType<typeof estimateRoundTrip>;
        cost: ReturnType<typeof estimateMonthlyCost>;
        score: number;
      }> = [];

      for (const stt of filteredStt) {
        for (const tts of filteredTts) {
          for (const llm of effectiveLlm) {
            const latency = estimateRoundTrip(stt, tts, llm, true);
            const cost = estimateMonthlyCost(stt, tts, llm, 30); // 30 min/day estimate

            // Skip if over latency or budget
            if (latency.perceivedMs > maxLatency * 1.5) continue;
            if (cost.monthly > monthlyCap) continue;

            // Score: lower is better (latency-weighted + cost penalty)
            const latencyScore = latency.perceivedMs / maxLatency;
            const costScore = monthlyCap > 0 ? cost.monthly / monthlyCap : 0;
            const qualityBonus =
              (stt.quality === "high" ? -0.1 : 0) +
              (tts.quality === "high" ? -0.1 : 0) +
              (llm.quality === "high" ? -0.1 : 0);

            candidates.push({
              stt,
              tts,
              llm,
              latency,
              cost,
              score: latencyScore * 0.5 + costScore * 0.3 + qualityBonus,
            });
          }
        }
      }

      candidates.sort((a, b) => a.score - b.score);
      const top3 = candidates.slice(0, 3);

      if (top3.length === 0) {
        return {
          error: false,
          recommended: null,
          alternatives: [],
          message: "No configurations meet the latency and budget constraints simultaneously. Try increasing maxLatencyMs or budget.",
          considerations: [
            `Max latency: ${maxLatency}ms`,
            `Monthly cap: $${monthlyCap}`,
            `Platform: ${platform}`,
            `Privacy: ${privacy}`,
          ],
        };
      }

      const formatCandidate = (c: (typeof top3)[0]) => ({
        stt: { name: c.stt.name, key: c.stt.key, latencyMs: c.stt.latencyMs, privacy: c.stt.privacy },
        tts: { name: c.tts.name, key: c.tts.key, latencyMs: c.tts.latencyMs, privacy: c.tts.privacy },
        llm: { name: c.llm.name, key: c.llm.key, firstTokenMs: c.llm.firstTokenMs, privacy: c.llm.privacy },
        estimatedLatencyMs: c.latency.perceivedMs,
        totalLatencyMs: c.latency.totalMs,
        latencyBreakdown: c.latency.breakdown,
        monthlyEstimate: `$${c.cost.monthly}`,
        costBreakdown: c.cost.breakdown,
        rating: rateLatency(c.latency.perceivedMs),
      });

      // Determine overall architecture
      const best = top3[0];
      const allLocal = best.stt.privacy === "local" && best.tts.privacy === "local" && best.llm.privacy === "local";
      const allCloud = best.stt.privacy === "cloud" && best.tts.privacy === "cloud" && best.llm.privacy === "cloud";
      const architecture = allLocal ? "local" : allCloud ? "cloud" : "hybrid";

      // Build considerations
      const considerations: string[] = [];
      if (best.latency.perceivedMs > 1500) {
        considerations.push("Perceived latency exceeds 1.5s — consider streaming TTS or a faster LLM.");
      }
      if (best.stt.privacy === "cloud") {
        considerations.push("STT sends audio to cloud — ensure compliance with data privacy requirements.");
      }
      if (best.tts.costPerMin > 0.1) {
        considerations.push("TTS cost is high — consider caching common phrases or pre-generating audio.");
      }
      if (platform === "browser" && (best.stt.key === "whisper" || best.tts.key === "piper")) {
        considerations.push("Selected engines require server-side processing — add a WebSocket bridge for browser use.");
      }
      if (best.llm.privacy === "local") {
        considerations.push("Local LLM requires adequate GPU/CPU — test on target hardware before committing.");
      }

      return {
        recommended: formatCandidate(best),
        alternatives: top3.slice(1).map(formatCandidate),
        architecture,
        considerations,
        _quickRef: {
          nextAction: "Use analyze_voice_config to validate the recommended stack, or generate_voice_scaffold to get starter code.",
          nextTools: ["analyze_voice_config", "generate_voice_scaffold", "benchmark_voice_latency"],
        },
      };
    },
  },

  // ─── Tool 2: analyze_voice_config ───────────────────────────────────────────
  {
    name: "analyze_voice_config",
    description:
      "Validate a voice pipeline configuration. Checks STT/TTS/LLM compatibility, estimates per-minute costs, identifies the latency bottleneck, and suggests optimizations (streaming, caching, pre-generation). Knowledge-based analysis, no live calls.",
    inputSchema: {
      type: "object",
      properties: {
        stt: {
          type: "string",
          description: "STT engine key or name (e.g. 'whisper', 'deepgram', 'web_speech_api_stt')",
        },
        tts: {
          type: "string",
          description: "TTS engine key or name (e.g. 'edge_tts', 'cartesia', 'piper', 'web_speech_api_tts')",
        },
        llm: {
          type: "string",
          description: "LLM key or name (e.g. 'claude_haiku_4_5', 'gpt5_mini', 'local_llama')",
        },
        targetLatencyMs: {
          type: "number",
          description: "Target round-trip latency in ms (default: 1500)",
        },
      },
      required: ["stt", "tts", "llm"],
    },
    handler: async (args) => {
      const sttEngine = findStt(args.stt);
      const ttsEngine = findTts(args.tts);
      const llmEngine = findLlm(args.llm);
      const targetLatency = args.targetLatencyMs ?? 1500;

      const warnings: string[] = [];
      const compatibility: string[] = [];
      const optimizations: string[] = [];

      // Check if engines are recognized
      if (!sttEngine) {
        warnings.push(`Unknown STT engine: '${args.stt}'. Known engines: ${STT_ENGINES.map((e) => e.key).join(", ")}`);
      }
      if (!ttsEngine) {
        warnings.push(`Unknown TTS engine: '${args.tts}'. Known engines: ${TTS_ENGINES.map((e) => e.key).join(", ")}`);
      }
      if (!llmEngine) {
        warnings.push(`Unknown LLM engine: '${args.llm}'. Known engines: ${LLM_ENGINES.map((e) => e.key).join(", ")}`);
      }

      if (!sttEngine || !ttsEngine || !llmEngine) {
        return {
          valid: false,
          compatibility: [],
          estimatedLatencyMs: null,
          costPerMinute: null,
          bottleneck: null,
          optimizations: [],
          warnings,
        };
      }

      // Compatibility checks
      const sttBrowserOnly = sttEngine.key === "web_speech_api_stt";
      const ttsBrowserOnly = ttsEngine.key === "web_speech_api_tts";

      if (sttBrowserOnly && !ttsBrowserOnly) {
        compatibility.push("Web Speech API STT is browser-only — TTS engine must also work in-browser or use a server bridge.");
      }
      if (ttsBrowserOnly && !sttBrowserOnly) {
        compatibility.push("Browser speechSynthesis is browser-only — STT engine must also work in-browser or use a server bridge.");
      }
      if (sttBrowserOnly || ttsBrowserOnly) {
        compatibility.push("Web Speech API is not available in Node.js — this config requires a browser environment.");
      }
      if (ttsEngine.key === "macos_say" && sttEngine.key !== "whisper_mlx" && sttEngine.key !== "whisper") {
        compatibility.push("macOS 'say' is Mac-only — ensure STT engine also supports macOS.");
      }
      if (llmEngine.privacy === "local" && sttEngine.privacy === "cloud") {
        compatibility.push("Mixed privacy: local LLM but cloud STT — audio still leaves the device.");
      }

      if (compatibility.length === 0) {
        compatibility.push("All components are compatible.");
      }

      // Latency estimation
      const latency = estimateRoundTrip(sttEngine, ttsEngine, llmEngine, true);
      const batchLatency = estimateRoundTrip(sttEngine, ttsEngine, llmEngine, false);

      // Identify bottleneck
      const { breakdown } = latency;
      const components = [
        { name: "STT", ms: breakdown.sttMs },
        { name: "LLM (first token)", ms: breakdown.llmFirstTokenMs },
        { name: "LLM (completion)", ms: breakdown.llmCompletionMs },
        { name: "TTS", ms: breakdown.ttsMs },
      ];
      components.sort((a, b) => b.ms - a.ms);
      const bottleneck = components[0].name;

      // Cost estimation
      const costPerMin =
        sttEngine.costPerMin +
        ttsEngine.costPerMin +
        (150 / 1000) * llmEngine.costPer1kTokens; // ~150 tokens/min

      // Optimization suggestions
      if (!sttEngine.streaming && sttEngine.latencyMs > 500) {
        optimizations.push(`STT bottleneck: ${sttEngine.name} is ${sttEngine.latencyMs}ms. Consider Deepgram (300ms, streaming) for lower latency.`);
      }
      if (ttsEngine.streaming) {
        optimizations.push("TTS supports streaming — enable it to reduce perceived latency by starting playback before generation completes.");
      } else {
        optimizations.push(`TTS (${ttsEngine.name}) does not support streaming — audio is generated in full before playback. Consider Cartesia or Edge TTS for streaming.`);
      }
      if (llmEngine.firstTokenMs > 500) {
        optimizations.push(`LLM first token is ${llmEngine.firstTokenMs}ms. For lower latency, consider Claude Haiku 4.5 (300ms) or GPT-5-mini (400ms).`);
      }
      if (latency.perceivedMs > targetLatency) {
        optimizations.push(`Perceived latency (${latency.perceivedMs}ms) exceeds target (${targetLatency}ms). Focus on reducing ${bottleneck}.`);
      }
      optimizations.push("Cache frequent responses (greetings, confirmations) as pre-generated audio to skip TTS entirely.");
      optimizations.push("Use streaming LLM output piped directly to streaming TTS to overlap computation with audio generation.");

      const valid = warnings.length === 0;

      return {
        valid,
        compatibility,
        estimatedLatencyMs: latency.perceivedMs,
        totalLatencyMs: latency.totalMs,
        batchLatencyMs: batchLatency.totalMs,
        latencyBreakdown: breakdown,
        costPerMinute: Math.round(costPerMin * 10000) / 10000,
        bottleneck,
        optimizations,
        warnings,
        rating: rateLatency(latency.perceivedMs),
        _quickRef: {
          nextAction: "Use generate_voice_scaffold to get starter code, or benchmark_voice_latency to compare alternatives.",
          nextTools: ["generate_voice_scaffold", "benchmark_voice_latency", "design_voice_pipeline"],
        },
      };
    },
  },

  // ─── Tool 3: generate_voice_scaffold ────────────────────────────────────────
  {
    name: "generate_voice_scaffold",
    description:
      "Generate starter code for a voice bridge. Returns file contents, setup instructions, and dependency lists for the selected stack. Stacks: whisper_edge (Python, Whisper + Edge TTS), deepgram_cartesia (TypeScript, cloud), browser_webspeech (HTML/JS, no server), whisper_piper (Python, fully local), custom (pluggable interfaces).",
    inputSchema: {
      type: "object",
      properties: {
        stack: {
          type: "string",
          enum: ["whisper_edge", "deepgram_cartesia", "browser_webspeech", "whisper_piper", "custom"],
          description: "Pre-built stack template to scaffold",
        },
        language: {
          type: "string",
          enum: ["typescript", "python"],
          description: "Language for 'custom' stack (default: typescript). Ignored for pre-built stacks.",
        },
        includeVAD: {
          type: "boolean",
          description: "Include Voice Activity Detection code (simple energy-based). Default: false.",
        },
      },
      required: ["stack"],
    },
    handler: async (args) => {
      const stack: string = args.stack;
      const language: string = args.language ?? "typescript";
      const includeVAD: boolean = args.includeVAD ?? false;

      let result: {
        files: Array<{ path: string; content: string; description: string }>;
        setupInstructions: string[];
        dependencies: string[];
      };

      switch (stack) {
        case "whisper_edge":
          result = getScaffoldWhisperEdge(includeVAD);
          break;
        case "deepgram_cartesia":
          result = getScaffoldDeepgramCartesia(includeVAD);
          break;
        case "browser_webspeech":
          result = getScaffoldBrowserWebspeech();
          break;
        case "whisper_piper":
          result = getScaffoldWhisperPiper(includeVAD);
          break;
        case "custom":
          result = getScaffoldCustom(language, includeVAD);
          break;
        default:
          return {
            error: true,
            message: `Unknown stack: '${stack}'. Choose from: whisper_edge, deepgram_cartesia, browser_webspeech, whisper_piper, custom.`,
          };
      }

      return {
        stack,
        language: stack === "browser_webspeech" ? "html/javascript" : stack === "custom" ? language : stack.includes("whisper") ? "python" : "typescript",
        includeVAD,
        files: result.files.map((f) => ({
          path: f.path,
          description: f.description,
          content: f.content,
          sizeBytes: Buffer.byteLength(f.content, "utf8"),
        })),
        setupInstructions: result.setupInstructions,
        dependencies: result.dependencies,
        _quickRef: {
          nextAction: "Review the generated files. Write them to disk, install dependencies, and test the pipeline.",
          nextTools: ["analyze_voice_config", "benchmark_voice_latency"],
        },
      };
    },
  },

  // ─── Tool 4: benchmark_voice_latency ────────────────────────────────────────
  {
    name: "benchmark_voice_latency",
    description:
      "Calculate theoretical latency for one or more voice pipeline configurations. Breaks down STT, LLM (first token + completion), and TTS latency. Shows total and user-perceived latency (with streaming optimizations). Rates each config as excellent/good/acceptable/poor. Knowledge-based, no live measurements.",
    inputSchema: {
      type: "object",
      properties: {
        configs: {
          type: "array",
          description: "Array of pipeline configurations to benchmark",
          items: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description: "Human-readable name for this configuration",
              },
              stt: {
                type: "string",
                description: "STT engine key (e.g. 'whisper', 'deepgram')",
              },
              tts: {
                type: "string",
                description: "TTS engine key (e.g. 'edge_tts', 'cartesia')",
              },
              llm: {
                type: "string",
                description: "LLM key (e.g. 'claude_haiku_4_5', 'gpt5_mini')",
              },
              streamingEnabled: {
                type: "boolean",
                description: "Whether streaming is enabled for TTS (default: true)",
              },
            },
            required: ["name", "stt", "tts", "llm"],
          },
        },
      },
      required: ["configs"],
    },
    handler: async (args) => {
      const configs: Array<{
        name: string;
        stt: string;
        tts: string;
        llm: string;
        streamingEnabled?: boolean;
      }> = args.configs ?? [];

      if (configs.length === 0) {
        return {
          error: true,
          message: "No configurations provided. Pass an array of {name, stt, tts, llm} objects.",
        };
      }

      const results: Array<{
        name: string;
        breakdown: { sttMs: number; llmFirstTokenMs: number; llmCompletionMs: number; ttsMs: number };
        totalMs: number;
        perceivedMs: number;
        rating: "excellent" | "good" | "acceptable" | "poor";
        errors?: string[];
      }> = [];

      for (const config of configs) {
        const sttEngine = findStt(config.stt);
        const ttsEngine = findTts(config.tts);
        const llmEngine = findLlm(config.llm);
        const streaming = config.streamingEnabled !== false;

        const errors: string[] = [];
        if (!sttEngine) errors.push(`Unknown STT: '${config.stt}'`);
        if (!ttsEngine) errors.push(`Unknown TTS: '${config.tts}'`);
        if (!llmEngine) errors.push(`Unknown LLM: '${config.llm}'`);

        if (errors.length > 0) {
          results.push({
            name: config.name,
            breakdown: { sttMs: 0, llmFirstTokenMs: 0, llmCompletionMs: 0, ttsMs: 0 },
            totalMs: 0,
            perceivedMs: 0,
            rating: "poor",
            errors,
          });
          continue;
        }

        const latency = estimateRoundTrip(sttEngine!, ttsEngine!, llmEngine!, streaming);

        results.push({
          name: config.name,
          breakdown: latency.breakdown,
          totalMs: latency.totalMs,
          perceivedMs: latency.perceivedMs,
          rating: rateLatency(latency.perceivedMs),
        });
      }

      // Sort by perceived latency for recommendation
      const validResults = results.filter((r) => !r.errors);
      validResults.sort((a, b) => a.perceivedMs - b.perceivedMs);

      const recommendation =
        validResults.length > 0
          ? `Best: '${validResults[0].name}' at ${validResults[0].perceivedMs}ms perceived latency (${validResults[0].rating}).`
          : "No valid configurations to compare.";

      // Generate insights
      const insights: string[] = [];
      if (validResults.length >= 2) {
        const fastest = validResults[0];
        const slowest = validResults[validResults.length - 1];
        insights.push(
          `Fastest config ('${fastest.name}') is ${slowest.perceivedMs - fastest.perceivedMs}ms faster than slowest ('${slowest.name}').`,
        );
      }

      const excellentCount = validResults.filter((r) => r.rating === "excellent").length;
      const poorCount = validResults.filter((r) => r.rating === "poor").length;
      if (excellentCount > 0) {
        insights.push(`${excellentCount} config(s) rated 'excellent' (under 500ms perceived latency).`);
      }
      if (poorCount > 0) {
        insights.push(`${poorCount} config(s) rated 'poor' (over 2000ms). Consider faster STT/TTS or streaming.`);
      }

      // Check for common bottleneck patterns
      for (const r of validResults) {
        if (r.breakdown.sttMs >= r.breakdown.llmFirstTokenMs + r.breakdown.ttsMs) {
          insights.push(`'${r.name}': STT is the dominant bottleneck (${r.breakdown.sttMs}ms). Consider cloud STT for lower latency.`);
          break;
        }
      }

      return {
        results,
        recommendation,
        insights,
        _quickRef: {
          nextAction: "Pick the best config and use generate_voice_scaffold to get starter code.",
          nextTools: ["generate_voice_scaffold", "analyze_voice_config", "design_voice_pipeline"],
        },
      };
    },
  },
];
