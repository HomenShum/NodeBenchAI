# Jarvis HUD Architecture & Open Source Path

This document outlines the architectural strategy for the "Jarvis HUD" high-performance, cinematic agent UI, and the roadmap for decoupling it into an open-source component library.

## 1. Core Principles: Cinematic & Fast

The goal is to achieve buttery-smooth 60fps cinematic animations (like an Iron Man HUD) without sacrificing web performance, even with heavy conversational context.

### Avoid React State for High-Frequency Events
- **Problem:** Tying mouse coordinates (`x, y`) or scroll positions to `useState` causes the entire component tree to re-render constantly.
- **Solution:** Use **CSS Custom Properties** updated via native DOM event listeners. 
  - See `JarvisHUDLayout.tsx` for an example of setting `--mouse-x` and `--mouse-y` via a `useRef` and a single `mousemove` event. This powers cinematic glow effects via `radial-gradient` masks with zero React render overhead.

### Orchestrated Morphing
- **Problem:** Animating a window shrinking from the center of the screen to a top-left corner widget using CSS transitions is clunky and mathematically difficult (handling both translation and scale cleanly).
- **Solution:** Use **Framer Motion's `layoutId`**.
  - By rendering two different components conditionally (one expanded, one minimized) but giving them the *same* `layoutId="jarvis-window"`, Framer Motion automatically calculates the FLIP (First, Last, Invert, Play) animation to morph between them seamlessly.

### Aggressive DOM Culling (Memory Safety)
- **Problem:** Chat interfaces grow infinitely. Rendering thousands of Markdown elements, Mermaid charts, and syntax highlighters will crash the browser tab.
- **Solution:**
  - **Unmount when minimized:** When the HUD minimizes to a corner task widget, the entire expanded `div` and its heavy children are destroyed (`{isExpanded && <FullDOM />}`).
  - **Virtualization when expanded:** Use tools like `@tanstack/react-virtual` inside the message list so only visible messages exist in the DOM.

---

## 2. Decoupling Strategy (Path to Open Source)

To open-source this component library, we must adopt an **Inversion of Control** architecture. The UI library should know *nothing* about NodeBench, Convex, or OpenAI.

### Step 1: Headless Hooks
Extract state management into headless hooks. Consumers will bring their own backend.
```tsx
// ❌ Bad: UI knows about Convex
function AgentChat() {
  const messages = useQuery(api.messages.get);
  // ...
}

// ✅ Good: UI accepts an interface
interface AgentStream {
  messages: Message[];
  status: "idle" | "streaming" | "done";
  submitPrompt: (text: string) => Promise<void>;
}

function AgentHUD({ stream }: { stream: AgentStream }) {
  // Pure presentational logic
}
```

### Step 2: Compound Components
Structure the exports so consumers can compose their own layouts.
```tsx
<AgentUI.Root stream={myCustomStreamStore}>
  <AgentUI.MinimizedWidget layoutId="hud" />
  
  <AgentUI.ExpandedWindow layoutId="hud">
    <AgentUI.Header>NODEBENCH // TACTICAL</AgentUI.Header>
    <AgentUI.ThreadList>
      {(msg) => <AgentUI.MessageBubble message={msg} />}
    </AgentUI.ThreadList>
    <AgentUI.InputBar />
  </AgentUI.ExpandedWindow>
</AgentUI.Root>
```

### Step 3: Package Isolation
1. Move the components out of `src/features/...` into a monorepo package like `packages/jarvis-hud-ui`.
2. Ensure `package.json` dependencies only include React, Framer Motion, and styling utilities (Tailwind/Lucide). No Convex or NodeBench-specific imports allowed.
3. Export a Tailwind plugin or CSS variable template so consumers can inject their own brand colors (replacing hardcoded `cyan-500`).

## 3. Reference Implementation
Review `JarvisHUDLayout.tsx` in this directory as the minimal Proof of Concept for the cinematic expand/collapse and mouse-tracking glow effects. Future work should iteratively merge the existing `FastAgentPanel` logic into this presentation shell.
