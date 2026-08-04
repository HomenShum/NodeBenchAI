/**
 * RedesignShell — NodeBench's single canonical decision workspace.
 *
 * Every primary NodeBench entry point resolves to the same live ChatSurface.
 * Saved reports, attention queues, settings, and reproducible receipts are
 * contextual states of the conversation rather than competing destinations.
 */

import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import "./tokens.css";
import "./primitives.css";
import "./agent-workspace.css";

import { MotionRoot } from "./components/motionPrims";
import { TopNav } from "./components/TopNav";
import { ChatSurface } from "./surfaces/ChatSurface";
import { parseChatLaunchParams } from "./lib/chatContinuation";
import { canonicalRedesignChatTarget, pathToChatHash } from "./lib/oneSurfaceRouting";

function readInitialTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.localStorage.getItem("nodebench:redesign:theme") === "dark" ? "dark" : "light";
}

export default function RedesignShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const [theme, setTheme] = useState<"light" | "dark">(readInitialTheme);

  const canonicalTarget = useMemo(
    () => canonicalRedesignChatTarget(location.pathname, location.search),
    [location.pathname, location.search],
  );
  const chatLaunch = useMemo(() => parseChatLaunchParams(location.search), [location.search]);
  const routeChatHash = useMemo(() => pathToChatHash(location.pathname), [location.pathname]);
  const continuationHash = chatLaunch.continuationHash ?? routeChatHash ?? undefined;

  useEffect(() => {
    if (canonicalTarget) navigate(canonicalTarget, { replace: true });
  }, [canonicalTarget, navigate]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem("nodebench:redesign:theme", theme);
  }, [theme]);

  return (
    <MotionRoot>
    <div
      data-redesign
      data-redesign-theme={theme}
      data-product-surface="decision-workspace"
      data-screen-id="decision-workspace"
      data-screen-title="NodeBench"
      data-screen-path="/redesign/chat"
      data-screen-state="ready"
      style={{
        height: "100dvh",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <TopNav
        theme={theme}
        onToggleTheme={() => setTheme((current) => current === "light" ? "dark" : "light")}
      />

      <div
        className="rd-shell rd-shell--home-v2 rd-shell--chat-v3 rd-shell--chat-focus rd-shell--chat-no-inspector"
        style={{ flex: 1, minHeight: 0 }}
      >
        <div className="rd-shell__main">
          <main id="main-content" data-main-content className="rd-pane">
            <div className="rd-surface-content" data-testid="one-surface-workspace">
              <ChatSurface
                initialPrompt={chatLaunch.prompt}
                continuationHash={continuationHash}
              />
            </div>
          </main>

        </div>
      </div>

      <div
        data-testid="redesign-active"
        data-redesign-surface="/redesign/chat"
        data-legacy-entry={location.pathname === "/redesign/chat" ? undefined : location.pathname}
        style={{ position: "absolute", left: -9999, top: -9999, opacity: 0 }}
        aria-hidden="true"
      >
        NodeBench decision workspace · /redesign/chat
      </div>
    </div>
    </MotionRoot>
  );
}
