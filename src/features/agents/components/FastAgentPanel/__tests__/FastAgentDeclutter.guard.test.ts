import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function source(file: string) {
  return readFileSync(resolve(process.cwd(), file), "utf8");
}

describe("FastAgent declutter guards", () => {
  it("keeps the unreachable nested command palette and its dead controls removed", () => {
    const panel = source("src/features/agents/components/FastAgentPanel/FastAgentPanel.tsx");
    const overlays = source("src/features/agents/components/FastAgentPanel/FastAgentPanel.PanelOverlays.tsx");

    for (const deadState of [
      "showCommandPalette",
      "showQuickReplies",
      "highContrast",
      "showModelComparison",
      "scheduledMessages",
      "false &&",
      "handleMermaidRetry",
      "handleCompanySelect",
      "handlePersonSelect",
      "handleEventSelect",
      "handleNewsSelect",
      "existing implementation",
    ]) {
      expect(panel).not.toContain(deadState);
    }
    expect(overlays).not.toContain("Command Palette");
    expect(overlays).not.toContain("Quick Replies");
    expect(overlays).not.toContain("High Contrast");
    expect(overlays).not.toContain("Ctrl+K");
    expect(panel).not.toContain("onCompanySelect: handleCompanySelect");
    expect(panel).not.toContain("onPersonSelect: handlePersonSelect");
    expect(panel).not.toContain("onEventSelect: handleEventSelect");
    expect(panel).not.toContain("onNewsSelect: handleNewsSelect");
  });

  it("keeps missing selection capabilities absent instead of exposing no-op controls", () => {
    const context = source("src/features/agents/components/FastAgentPanel/MessageHandlersContext.tsx");

    expect(context).toContain("const defaultHandlers: MessageHandlers = {};");
    expect(context).not.toMatch(/onCompanySelect:\s*\(\)\s*=>\s*\{\}/);
    expect(context).not.toMatch(/onPersonSelect:\s*\(\)\s*=>\s*\{\}/);
    expect(context).not.toMatch(/onEventSelect:\s*\(\)\s*=>\s*\{\}/);
    expect(context).not.toMatch(/onNewsSelect:\s*\(\)\s*=>\s*\{\}/);
  });

  it("keeps removed telemetry navigation and private guest task history unreachable", () => {
    const panel = source("src/features/agents/components/FastAgentPanel/FastAgentPanel.tsx");
    const context = source("src/features/agents/context/FastAgentContext.tsx");
    const hub = source("src/features/agents/views/AgentsHub.tsx");

    expect(panel).not.toContain('["chat", "sources", "telemetry", "trace"]');
    expect(context).not.toContain('"sources" | "telemetry" | "trace"');
    expect(hub).toMatch(/\{isAuthenticated \? \([\s\S]*?<TaskManagerView isPublic=\{false\}/);
  });

  it("does not invent default object-first chat actions", () => {
    const chatLane = source("src/features/chat/components/ChatLane.tsx");

    expect(chatLane).not.toContain("DEFAULT_SUGGESTIONS");
    expect(chatLane).not.toContain("onClick: () => {}");
    expect(chatLane).not.toContain("MoreHorizontal");
    expect(chatLane).toContain("suggestions.length > 0");
  });

  it("does not read rendered messages before their memo is initialized", () => {
    const panel = source("src/features/agents/components/FastAgentPanel/FastAgentPanel.tsx");

    expect(panel).toContain("const renderedMessagesRef = useRef<any[]>([]);");
    expect(panel).toContain("renderedMessagesRef.current = messagesToRender;");
    expect(panel).not.toContain("[isOpen, messagesToRender,");
  });

  it("follows the reachable rendered stream without overriding a reader who scrolled away", () => {
    const panel = source("src/features/agents/components/FastAgentPanel/FastAgentPanel.tsx");

    expect(panel).toContain("autoScrollEnabledRef.current = distanceFromBottom < 30;");
    expect(panel).toMatch(/if \(autoScrollEnabledRef\.current\) \{[\s\S]*?messagesEndRef\.current\?\.scrollIntoView/);
    expect(panel).toContain("}, [isBusy, messagesToRender]);");
    expect(panel).not.toContain("[messages, liveThinking, liveToolCalls]");
    expect(panel).not.toContain("liveThinking");
    expect(panel).not.toContain("liveToolCalls");
  });

  it("keeps every composer-focus path and the skip link correct in both panel modes", () => {
    const panel = source("src/features/agents/components/FastAgentPanel/FastAgentPanel.tsx");

    expect(panel).toMatch(/function focusFastAgentComposer\(\)[\s\S]*?'\.fast-agent-panel #product-intake-query, \.fast-agent-panel #fa-chat-input'/);
    expect(panel.match(/focusFastAgentComposer\(\);/g)).toHaveLength(4);
    expect(panel.match(/document\.querySelector<HTMLTextAreaElement>/g)).toHaveLength(1);
    expect(panel).toContain("href={isProductConversationMode ? '#product-intake-query' : '#fa-chat-input'}");
  });

  it("processes contextual opens once on every viewport and waits for a runtime owner", () => {
    const panel = source("src/features/agents/components/FastAgentPanel/FastAgentPanel.tsx");
    const contextualOpen = panel.slice(
      panel.indexOf("// Apply openOptions once per requestId"),
      panel.indexOf("// Persist dossier context"),
    );
    const autoSend = panel.slice(
      panel.indexOf("// Auto-send contextual open prompt"),
      panel.indexOf("// No client heuristics"),
    );

    // CockpitLayout owns one responsive slide-over, so no CSS-breakpoint branch may
    // prevent its mounted panel from consuming the request on mobile or tablet.
    expect(contextualOpen).not.toContain("matchMedia");
    expect(contextualOpen).not.toContain("isViewportActiveVariant");
    expect(autoSend).not.toContain("matchMedia");
    expect(autoSend).not.toContain("isViewportActiveVariant");

    // A set preserves exactly-once semantics even if an old request id reappears
    // after a different request, instead of remembering only the immediately prior id.
    expect(panel).toContain("const handledOpenRequestIdsRef = useRef<Set<string>>(new Set());");
    expect(panel).toContain("const autoSentRequestIdsRef = useRef<Set<string>>(new Set());");
    expect(panel).toContain("const autoSendInFlightRequestIdsRef = useRef<Set<string>>(new Set());");
    expect(panel).toContain("const autoSendFailedRequestIdsRef = useRef<Set<string>>(new Set());");
    expect(contextualOpen).toContain("handledOpenRequestIdsRef.current.has(requestId)");
    expect(contextualOpen).toContain("handledOpenRequestIdsRef.current.add(requestId)");
    expect(autoSend).toContain("autoSentRequestIdsRef.current.has(requestId)");
    expect(autoSend).toContain("autoSentRequestIdsRef.current.add(requestId)");
    expect(autoSend).toContain("autoSendFailedRequestIdsRef.current.add(requestId)");
    expect(autoSend).toContain("setInput(message)");
    expect(autoSend.indexOf("stableSendMessage(message)")).toBeLessThan(autoSend.indexOf("autoSentRequestIdsRef.current.add(requestId)"));
    const acceptedDispatch = autoSend.slice(autoSend.indexOf("autoSentRequestIdsRef.current.add(requestId)"));
    expect(acceptedDispatch.indexOf("autoSentRequestIdsRef.current.add(requestId)")).toBeLessThan(acceptedDispatch.indexOf("onOptionsConsumed?.()"));

    // Readiness must be checked before reserving the id, dispatching, or consuming
    // the options; otherwise the send handler rejects it and the prompt is lost.
    const readyGuard = autoSend.indexOf("if (!runtimeOwnerReady) return;");
    expect(readyGuard).toBeGreaterThan(-1);
    expect(readyGuard).toBeLessThan(autoSend.indexOf("autoSentRequestIdsRef.current.add(requestId)"));
    expect(readyGuard).toBeLessThan(autoSend.indexOf("stableSendMessage(message)"));
    expect(readyGuard).toBeLessThan(autoSend.indexOf("onOptionsConsumed?.()"));
    expect(autoSend).toContain("runtimeOwnerReady,");
  });

  it("migrates removed legacy chat mode instead of restoring dead actions", () => {
    const panel = source("src/features/agents/components/FastAgentPanel/FastAgentPanel.tsx");

    expect(panel).toContain("useState<'agent' | 'agent-streaming'>('agent-streaming')");
    expect(panel).not.toContain("localStorage.getItem('fastAgentPanel.chatMode')");
  });

  it("requires runtime backing before citations or entities become controls", () => {
    const bubble = source("src/features/agents/components/FastAgentPanel/FastAgentPanel.UIMessageBubble.tsx");
    const spans = source("src/features/research/components/InteractiveSpanParser.tsx");

    expect(bubble).not.toContain("parseCitationUrlsFromText");
    expect(bubble).toContain("if (!base) continue;");
    expect(bubble).toContain("if (!enrichment?.dossierId && !enrichment?.url) continue;");
    expect(bubble).not.toContain("href={c.url || '#'}");
    expect(bubble).not.toContain("timeAgo || 'recently'");
    expect(spans).toContain("{customLabel || \"source\"}");
    expect(spans).toContain("{displayName || entityId}");
  });

  it("keeps executable and document controls behind successful runtime output", () => {
    const bubble = source("src/features/agents/components/FastAgentPanel/FastAgentPanel.UIMessageBubble.tsx");
    const documents = source("src/features/agents/components/FastAgentPanel/DocumentActionCard.tsx");
    const provenance = source("src/features/agents/components/FastAgentPanel/FastAgentPanel.provenance.ts");

    expect(bubble).not.toContain("new Function");
    expect(bubble).not.toContain("RunCodeButton");
    expect(bubble).not.toContain("displayText.length / 2000");
    expect(documents).not.toContain("export function extractDocumentActions(");
    expect(bubble).toContain(
      "extractDocumentActionsFromToolOutput(getAvailableToolOutput(part))",
    );
    expect(bubble).not.toMatch(/extractDocumentActionsFromToolOutput\((?:visibleText|text|partText)/);
    expect(provenance).toContain(
      "if (toolPart.state !== \"output-available\") continue;",
    );
    expect(provenance).toContain(
      "extractDocumentActionsFromToolOutput(toolPart.output)",
    );
  });

  it("keeps global navigation controls wired to real destinations", () => {
    const palette = source("src/layouts/chrome/CommandPalette.tsx");
    const cockpit = source("src/layouts/CockpitLayout.tsx");
    const rail = source("src/layouts/WorkspaceRail.tsx");

    expect(palette).not.toContain("Create New Document");
    expect(palette).not.toContain("Create New Task");
    expect(palette).toContain("extra: { focus: 'home-composer' }");
    expect(palette).not.toContain("focusCanonicalHomeComposer");
    expect(palette).not.toContain("document.getElementById('home-query')");
    expect(palette).toContain("new CustomEvent('nodebench:openDocument'");
    expect(palette).not.toContain("navigate(`/documents/${doc._id}`)");
    expect(cockpit).not.toContain('new CustomEvent("document:create")');
    expect(rail).toContain('onClick={() => navigate(buildCockpitPath({ surfaceId: "connect" }))}');
  });

  it("lets unsupported create phrases fall through to the real agent", () => {
    const cockpit = source("src/layouts/CockpitLayout.tsx");
    const voiceRouter = source("src/hooks/useVoiceIntentRouter.ts");

    for (const deadEmitter of ["document:create", "voice:create-task", "voice:create-event"]) {
      expect(cockpit).not.toContain(deadEmitter);
    }
    for (const fakeIntent of ["createDocument", "createTask", "createEvent"]) {
      expect(cockpit).not.toContain(fakeIntent);
      expect(voiceRouter).not.toContain(fakeIntent);
    }
  });

  it("keeps advertised focus and connection labels truthful", () => {
    const panel = source("src/features/agents/components/FastAgentPanel/FastAgentPanel.tsx");
    const inputBar = source("src/features/agents/components/FastAgentPanel/FastAgentPanel.InputBar.tsx");
    const status = source("src/layouts/StatusStrip.tsx");

    expect(panel).not.toContain('[placeholder="Message..."]');
    expect(inputBar).toContain('data-testid="fast-agent-prompt-input"');
    expect(panel).toContain("focusFastAgentComposer");
    expect(status).not.toContain("All systems operational");
    expect(status).not.toContain("nodebench:chat-header-action");
    expect(status).not.toContain("CHAT_MODEL_OPTIONS");
    expect(status).not.toContain("Model selector");
    expect(status).toContain('entityName?.trim() || "Chat"');
    expect(status).toContain('label: "You are offline"');
    expect(status).toContain('label: "Session connection delayed"');
    expect(status).toContain('label: "Checking session"');
    expect(status).toContain('label: "Connected"');
    expect(status).toContain('label: "Guest session"');
  });

  it("does not mutate the runtime thread array and exposes rows to keyboards", () => {
    const threads = source("src/features/agents/components/FastAgentPanel/FastAgentPanel.ThreadList.tsx");

    expect(threads.match(/let filtered = \[\.\.\.threads\];/g)).toHaveLength(2);
    expect(threads).toContain('role="button"');
    expect(threads).toContain('tabIndex={0}');
    expect(threads).toContain('event.key === "Enter" || event.key === " "');
  });
});
