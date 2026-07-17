import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("NodeBench one-surface product contract", () => {
  const app = read("src/App.tsx");
  const shell = read("src/features/redesign/RedesignShell.tsx");
  const header = read("src/features/redesign/components/TopNav.tsx");
  const chat = read("src/features/redesign/surfaces/ChatSurface.tsx");
  const workspaceCss = read("src/features/redesign/agent-workspace.css");

  it("mounts only the canonical decision workspace in the primary shell", () => {
    expect(shell).toContain('data-product-surface="decision-workspace"');
    expect(shell).toContain("<ChatSurface");
    expect(shell).not.toContain("<MobileShell");
    expect(shell).not.toContain("<ReportsSurface");
    expect(shell).not.toContain("<InboxSurface");
    expect(shell).not.toContain("<MeSurface");
    expect(shell).not.toContain("<WorkspaceSurface");
    expect(shell).not.toContain("<CommandPalette");
    expect(shell).not.toContain("<ShortcutsOverlay");
    expect(shell).not.toContain("<RightInspector");
  });

  it("keeps the header free of page navigation and duplicate input", () => {
    expect(header).not.toContain("const NAV");
    expect(header).not.toContain("Primary navigation");
    expect(header).not.toContain("Find a person, company, or action");
    expect(header).not.toContain("wideMode");
    expect(header).toContain("Sign in");
    expect(header).toContain("DropdownMenu");
    expect(header).toContain("Account menu");
    expect(header).toContain("Sign out");
    expect(header).toContain("Switch to dark mode");
  });

  it("keeps contextual chat actions inside the same surface", () => {
    expect(chat).not.toMatch(/\/redesign\/(?:reports|inbox|me|workspace)/);
    expect(chat).toContain("/redesign/chat?report=");
    expect(chat).toContain("requestedIntent");
    expect(chat).toContain("<LaunchContextCard");
    expect(chat).toContain("buildLiveContextRef(liveDetail, requestedArtifactKey)");
    expect(chat).not.toContain("Review settings");
    expect(chat).toContain("How we got this answer");
    expect(chat).toContain("sourceUrlFromText");
  });

  it("keeps read scope visible on mobile", () => {
    expect(workspaceCss).toMatch(/span:first-of-type[^{]*\{[^}]*display:\s*block/s);
    expect(workspaceCss).not.toMatch(/rd-run-scope[^}]*display:\s*none/s);
  });

  it("routes the root application to chat on desktop and mobile", () => {
    expect(app).toContain('const shouldUseRedesignLanding = location.pathname === "/"');
    expect(app).toContain("<Navigate to={`/redesign/chat");
    expect(app).toContain('return <Navigate to="/redesign/chat" replace />');
    expect(app).not.toContain("<CockpitLayout");
    expect(app).not.toContain("<GlobalFastAgentPanel");
    expect(app).not.toContain("<ReportDetailPage");
    expect(app).not.toContain("<ReportNotebookDetail");
    expect(app).toContain('nextParams.set("artifact", artifact)');
    expect(app).toContain("const isStandaloneWorkspaceRoute = isWorkspaceHost");
    expect(app).not.toContain("!isMobileViewport");
  });
});
