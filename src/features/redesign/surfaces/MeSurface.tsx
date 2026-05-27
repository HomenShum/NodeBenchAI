/**
 * Me - Personal Context Notebook (USER.md as editable memory draft).
 *
 * Aligns with the locked design board (proposed-design-views.html#me-view):
 *   - 3-card runtime row: "How NodeBench sees you" · product.me profile · USER.md document
 *   - TipTap-style toolbar with local draft save-state pill
 *   - Per-section editable memory rows + permission pill stack
 *   - Patch inbox aside (suggested patch with Accept / Edit diff / Reject)
 *   - User-facing memory, privacy, source, connector, and budget controls
 *   - Safety policy switches
 *
 * Locked rules preserved: Me shell, profile/files/plan/connectors, privacy + budget controls.
 * Delta: replace form-only memory with editable USER.md, add patch inbox, expose section-level
 * usage controls.
 */

import { useMemo, useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import { Pill } from "../components/Pill";
import { StyleGalleryCard } from "../components/StyleGalleryCard";
import { memoStyles, inferredStyleProvenance, type MemoStyle } from "../fixtures";
import { showToast } from "../components/Toast";

type SectionId = "background" | "communication" | "evidence" | "privacy";

type PermissionId =
  | "chat"
  | "reports"
  | "exports"
  | "global_pref"
  | "teachability"
  | "free_first"
  | "approve_paid"
  | "private"
  | "diff_required";

const PERM_LABEL: Record<PermissionId, string> = {
  chat: "chat",
  reports: "reports",
  exports: "exports",
  global_pref: "global pref",
  teachability: "teachability",
  free_first: "free first",
  approve_paid: "approve paid",
  private: "private",
  diff_required: "diff required",
};

interface Section {
  id: SectionId;
  heading: string;
  body: string;
  permissions: Array<{ id: PermissionId; pressed: boolean }>;
}

const INITIAL_SECTIONS: Section[] = [
  {
    id: "background",
    heading: "# Background",
    body:
      "Building NodeBench as an entity intelligence workspace. Wants research workflows to preserve personal analytical style.",
    permissions: [
      { id: "chat", pressed: true },
      { id: "reports", pressed: true },
      { id: "exports", pressed: false },
    ],
  },
  {
    id: "communication",
    heading: "# Communication style",
    body:
      "Prefer concise banker-style memos: answer, evidence, risk, next action. Keep claims citation-aware.",
    permissions: [
      { id: "global_pref", pressed: true },
      { id: "teachability", pressed: false },
    ],
  },
  {
    id: "evidence",
    heading: "# Evidence and budget",
    body:
      "Memory first, then source cache, then public refresh. Paid or connector-backed actions require explicit approval.",
    permissions: [
      { id: "free_first", pressed: true },
      { id: "approve_paid", pressed: false },
    ],
  },
  {
    id: "privacy",
    heading: "# Privacy boundaries",
    body:
      "Private captures stay private. Connector writes, CRM writes, and sharing defaults are review-only patches.",
    permissions: [
      { id: "private", pressed: true },
      { id: "diff_required", pressed: false },
    ],
  },
];

export function MeSurface() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signIn } = useAuthActions();
  const [sections, setSections] = useState<Section[]>(INITIAL_SECTIONS);
  const [purpose, setPurpose] = useState("Control, editable memory, privacy, budget, files, integrations.");
  const [savedAt, setSavedAt] = useState("Local draft saved");
  const [patch, setPatch] = useState("You often rewrite reports into banker-style next actions.");
  const [policies, setPolicies] = useState({
    autoSaveExplicit: true,
    suggestLowRisk: true,
    diffPrivacy: true,
  });
  const showDevHooks = useMemo(() => {
    if (typeof window === "undefined") return false;
    const params = new URLSearchParams(window.location.search);
    return params.get("qa") === "1" || params.get("debugUi") === "1";
  }, []);

  if (isLoading || !isAuthenticated) {
    return (
      <MeV2DocumentCenter
        mode={isLoading ? "loading" : "guest"}
        sections={[]}
        savedAt={isLoading ? "Resolving private session" : "Sign in to create USER.md"}
        onPrimary={() => {
          if (isLoading) return;
          void signIn("google", {
            redirectTo: typeof window !== "undefined" ? window.location.href : "/redesign/me",
          });
        }}
      />
    );
  }

  if (!isLoading && !isAuthenticated) {
    return (
      <div className="rd-stack" style={{ padding: "28px 40px 40px", gap: 20, maxWidth: 1120 }}>
        <header className="rd-row--between" style={{ gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div className="rd-stack" style={{ gap: 6, maxWidth: 760 }}>
            <div className="rd-eyebrow">Me · Private Context</div>
            <h1 className="rd-h1" style={{ fontSize: 30 }}>Your profile starts empty.</h1>
            <p className="rd-soft" style={{ fontSize: 14, lineHeight: 1.6, margin: 0 }}>
              NodeBench does not show another operator's memory to visitors. Link an email or Google account to save preferences, watched entities, connector permissions, budget rules, and reusable writing style.
            </p>
          </div>
          <button
            type="button"
            className="rd-btn rd-btn--primary"
            onClick={() => void signIn("google", {
              redirectTo: typeof window !== "undefined" ? window.location.href : "/redesign/me",
            })}
          >
            Continue with Google
          </button>
        </header>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }} className="me-runtime-grid">
          <section className="rd-card rd-card__pad">
            <div className="rd-eyebrow">Memory</div>
            <h3 style={{ margin: "8px 0 4px", fontSize: 17 }}>No saved profile yet</h3>
            <p className="rd-soft" style={{ fontSize: 12.5, lineHeight: 1.55 }}>
              Add communication style, evidence preferences, watched markets, and report defaults after sign-in.
            </p>
          </section>
          <section className="rd-card rd-card__pad">
            <div className="rd-eyebrow">Permissions</div>
            <h3 style={{ margin: "8px 0 4px", fontSize: 17 }}>Connectors are off</h3>
            <p className="rd-soft" style={{ fontSize: 12.5, lineHeight: 1.55 }}>
              Gmail, Slack, Notion, CRM, and export writes require explicit account connection and approval rules.
            </p>
          </section>
          <section className="rd-card rd-card__pad">
            <div className="rd-eyebrow">Budget</div>
            <h3 style={{ margin: "8px 0 4px", fontSize: 17 }}>Paid calls are blocked</h3>
            <p className="rd-soft" style={{ fontSize: 12.5, lineHeight: 1.55 }}>
              Public browsing stays read-only. Paid research runs only after an email-backed account is linked.
            </p>
          </section>
        </div>
        <section className="rd-card rd-card__pad" style={{ background: "var(--rd-paper-warm)" }}>
          <div className="rd-eyebrow">What gets saved after sign-in</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10, marginTop: 12 }} className="me-runtime-grid">
            {[
              ["Writing style", "How concise, technical, or source-heavy reports should be."],
              ["Watchlists", "Companies, people, markets, and events you want tracked."],
              ["Approval rules", "What the agent may update automatically versus ask first."],
              ["Audit trail", "Profile changes, connector writes, research budget, and exported artifacts."],
            ].map(([title, body]) => (
              <div key={title} className="rd-card" style={{ padding: 12, background: "var(--rd-panel)" }}>
                <strong style={{ display: "block", fontSize: 12.5, color: "var(--rd-ink-strong)" }}>{title}</strong>
                <p className="rd-faint" style={{ margin: "5px 0 0", fontSize: 11.5, lineHeight: 1.5 }}>{body}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    );
  }

  const markLocalSaved = () => {
    setSavedAt("Saving local draft...");
    setTimeout(() => setSavedAt("Local draft saved"), 600);
  };

  const previewAction = (label: string) => {
    showToast({
      tone: "info",
      message: `${label} is queued as a local Me-page preview. Durable profile writes require an authenticated profile sync.`,
    });
  };

  const acceptPatch = () => {
    if (!patch.trim()) return;
    setSections((prev) =>
      prev.map((section) =>
        section.id === "communication"
          ? {
              ...section,
              body: section.body.includes(patch.trim())
                ? section.body
                : `${section.body}\n\n${patch.trim()}`,
            }
          : section,
      ),
    );
    setPatch("");
    markLocalSaved();
    showToast({ tone: "success", message: "Applied the suggested patch to the local USER.md draft." });
  };

  const rejectPatch = () => {
    setPatch("");
    markLocalSaved();
    showToast({ tone: "warning", message: "Rejected the suggested patch locally." });
  };

  const updatePolicy = (key: keyof typeof policies, value: boolean) => {
    setPolicies((p) => ({ ...p, [key]: value }));
    markLocalSaved();
  };

  const togglePerm = (sectionId: SectionId, permId: PermissionId) => {
    setSections((prev) =>
      prev.map((s) =>
        s.id === sectionId
          ? {
              ...s,
              permissions: s.permissions.map((p) =>
                p.id === permId ? { ...p, pressed: !p.pressed } : p
              ),
            }
          : s
      )
    );
    markLocalSaved();
  };

  const updateBody = (sectionId: SectionId, body: string) => {
    setSections((prev) => prev.map((s) => (s.id === sectionId ? { ...s, body } : s)));
    markLocalSaved();
  };

  return (
    <MeV2DocumentCenter
      mode="authenticated"
      sections={sections}
      savedAt={savedAt}
      patch={patch}
      onPrimary={() => {
        markLocalSaved();
        showToast({ tone: "success", message: "USER.md local draft saved. Durable profile sync remains approval-gated." });
      }}
      onPatch={acceptPatch}
      onRejectPatch={rejectPatch}
    />
  );

  return (
    <div className="rd-stack" style={{ padding: "28px 40px 40px", gap: 20, maxWidth: 1280 }}>
      {/* Compact header — Personal Context first, no chrome competing for attention */}
      <header className="rd-row--between" style={{ gap: 16, alignItems: "baseline", flexWrap: "wrap" }}>
        <div className="rd-stack" style={{ gap: 4, minWidth: 0 }}>
          <div className="rd-eyebrow">Me · Personal Context Notebook</div>
          <h1 className="rd-h1" style={{ fontSize: 26 }}>This is what NodeBench remembers about you.</h1>
          <CompletenessMeter sections={sections} />
          <p
            className="rd-faint"
            contentEditable
            suppressContentEditableWarning
            onBlur={(e) => setPurpose(e.currentTarget.textContent ?? purpose)}
            role="textbox"
            aria-label="Edit Me page purpose"
            style={{
              maxWidth: 720,
              fontSize: 13,
              padding: "2px 6px",
              borderRadius: 8,
              border: "1px solid transparent",
              outline: "none",
              marginTop: 2,
            }}
          >Editable memory draft. Live reports and chats can read persisted operator profile data once the profile tools save it.</p>
        </div>
        <div className="rd-row" style={{ gap: 6, flexWrap: "wrap" }}>
          <button
            type="button"
            className="rd-btn rd-btn--quiet rd-btn--sm"
            onClick={() => exportUserMd(sections)}
            title="Download your USER.md as a markdown file"
          >Export USER.md</button>
          <SaveStatePill state={savedAt} />
        </div>
      </header>

      {/* Notebook + aside — HERO row, takes attention as USER.md is the personal context. */}
      <div className="me-notebook-grid" style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1.7fr) minmax(280px, 1fr)",
        gap: 14,
        alignItems: "flex-start",
      }}>
        <article className="rd-card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Hero label + minimal toolbar — Save pill now lives in page header */}
          <div className="rd-row--between" style={{ paddingBottom: 8, borderBottom: "1px solid var(--rd-line-faint)" }}>
            <div className="rd-eyebrow" style={{ fontSize: 11, color: "var(--rd-accent-strong)" }}>USER.md · editable local draft</div>
            <div className="rd-row" style={{ gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
              {(["H2", "B", "I", "UL", "1.", "''", "Undo", "Redo"] as const).map((label) => (
                <button
                  key={label}
                  type="button"
                  aria-label={`TipTap ${label}`}
                  onClick={() => previewAction(`Toolbar ${label}`)}
                  className="rd-btn rd-btn--quiet"
                  style={{
                    width: label.length > 2 ? 44 : 32, height: 32, padding: 0,
                    borderRadius: 6,
                    border: "1px solid var(--rd-line-faint)",
                    background: "transparent",
                    fontSize: 10.5, fontWeight: 700,
                    color: "var(--rd-ink-soft)",
                  }}
                >{label}</button>
              ))}
            </div>
          </div>

          {sections.map((section, idx) => (
            <div
              key={section.id}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) auto",
                gap: 10,
                alignItems: "flex-start",
                padding: "10px 0",
                borderTop: idx === 0 ? "none" : "1px dashed var(--rd-line)",
              }}
              className="me-section-row"
            >
              <div style={{ minWidth: 0 }}>
                <h4 style={{ margin: "0 0 5px", fontSize: 14, fontWeight: 590, color: "var(--rd-ink-strong)" }}>
                  {section.heading}
                </h4>
                <p
                  contentEditable
                  suppressContentEditableWarning
                  onBlur={(e) => updateBody(section.id, e.currentTarget.textContent ?? section.body)}
                  role="textbox"
                  aria-label={`Edit ${section.heading}`}
                  style={{
                    fontFamily: "var(--rd-font-sans)",
                    fontSize: 12.5,
                    lineHeight: 1.55,
                    color: "var(--rd-ink-mute)",
                    margin: 0,
                    padding: "5px 6px",
                    borderRadius: 8,
                    border: "1px solid transparent",
                    outline: "none",
                    whiteSpace: "pre-wrap",
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = "var(--rd-accent-ring)";
                    e.currentTarget.style.background = "var(--rd-accent-tint)";
                  }}
                  onBlurCapture={(e) => {
                    e.currentTarget.style.borderColor = "transparent";
                    e.currentTarget.style.background = "transparent";
                  }}
                >{section.body}</p>
              </div>
              <div className="rd-row" style={{ gap: 4, flexWrap: "wrap", justifyContent: "flex-end", minWidth: 175 }}>
                {section.permissions.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={p.pressed}
                    onClick={() => togglePerm(section.id, p.id)}
                    className="rd-btn"
                    style={{
                      padding: "4px 10px",
                      borderRadius: "var(--rd-r-pill)",
                      fontSize: 11,
                      fontWeight: p.pressed ? 590 : 500,
                      background: p.pressed ? "var(--rd-accent-tint)" : "var(--rd-muted)",
                      color: p.pressed ? "var(--rd-accent-strong)" : "var(--rd-ink-soft)",
                      border: `1px solid ${p.pressed ? "var(--rd-accent-ring)" : "transparent"}`,
                      opacity: p.pressed ? 1 : 0.7,
                    }}
                  >{PERM_LABEL[p.id]}</button>
                ))}
              </div>
            </div>
          ))}
        </article>

        <aside className="rd-stack" style={{ gap: 12 }}>
          {/* Memory update inbox */}
          <div className="rd-card rd-card__pad" style={{
            background: "var(--rd-accent-tint)",
            borderColor: "var(--rd-accent-ring)",
          }}>
            <div className="rd-eyebrow" style={{ color: "var(--rd-accent-strong)" }}>Memory update inbox</div>
            <h4 style={{ margin: "6px 0 4px", fontSize: 14, fontWeight: 590, color: "var(--rd-ink-strong)" }}>
              Suggested patch
            </h4>
            <textarea
              value={patch}
              onChange={(e) => setPatch(e.target.value)}
              aria-label="Edit suggested memory patch"
              style={{
                width: "100%",
                minHeight: 82,
                marginTop: 6,
                padding: 10,
                resize: "vertical",
                border: "1px solid var(--rd-line)",
                borderRadius: 12,
                color: "var(--rd-ink)",
                background: "var(--rd-panel)",
                fontFamily: "var(--rd-font-mono)",
                fontSize: 12,
                lineHeight: 1.5,
                outline: "none",
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "var(--rd-accent-ring)";
                e.currentTarget.style.boxShadow = "0 0 0 3px var(--rd-accent-soft)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "var(--rd-line)";
                e.currentTarget.style.boxShadow = "none";
              }}
            />
            <div className="rd-row" style={{ gap: 6, marginTop: 10, flexWrap: "wrap" }}>
              <button className="rd-btn rd-btn--primary rd-btn--sm" onClick={acceptPatch}>Accept local</button>
              <button className="rd-btn rd-btn--quiet rd-btn--sm" onClick={() => previewAction("Edit diff")}>Edit diff preview</button>
              <button className="rd-btn rd-btn--quiet rd-btn--sm" onClick={rejectPatch}>Reject local</button>
            </div>
          </div>

          {/* User-facing profile controls. Raw implementation hooks stay behind QA mode. */}
          <div className="rd-card rd-card__pad">
            <div className="rd-eyebrow">{showDevHooks ? "Agent implementation hooks" : "Profile controls"}</div>
            <ul className="rd-stack" style={{ gap: 7, marginTop: 8, listStyle: "none", padding: 0 }}>
              {(showDevHooks
                ? [
                    { strong: "Open RichNotebookEditor", body: "TipTap toolbar, save-state, slash commands, proposals, claim blocks" },
                    { strong: "Open teachability memory tools", body: "analyzeAndStoreTeachings, storeTeaching, searchTeachings, getTopPreferencesTool" },
                    { strong: "Open operatorProfile contract", body: "upsertProfile, getProfileMarkdown, parseOperatorMarkdown, filesystem sync" },
                    { strong: "Open OpenClaw audit tools", body: "spawn session, execute skill, retrieve audit, end session" },
                  ]
                : [
                    { strong: "Review remembered preferences", body: "See the working style and evidence rules the agent is allowed to reuse." },
                    { strong: "Manage connected data", body: "Choose which files, inboxes, calendars, and source caches can inform reports." },
                    { strong: "Set approval rules", body: "Require review before external research, connector writes, CRM exports, and shared artifacts." },
                    { strong: "Download profile record", body: "Export the current memory, privacy, budget, and source-use settings." },
                  ]).map((hook) => (
                <li key={hook.strong}>
                  <button
                    type="button"
                    className="rd-btn rd-btn--quiet"
                    onClick={() => previewAction(hook.strong)}
                    style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "7px 10px",
                    border: "1px solid var(--rd-line)",
                    borderRadius: 10,
                    background: "var(--rd-panel)",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    whiteSpace: "normal",
                    gap: 2,
                  }}>
                    <strong style={{
                      display: "block",
                      color: "var(--rd-ink-strong)",
                      fontSize: 11.5,
                      fontWeight: 590,
                      fontFamily: "var(--rd-font-sans)",
                      overflowWrap: "anywhere",
                    }}>{hook.strong}</strong>
                    <span style={{
                      color: "var(--rd-ink-mute)",
                      fontFamily: "var(--rd-font-mono)",
                      fontSize: 10.5,
                      lineHeight: 1.45,
                      overflowWrap: "anywhere",
                      whiteSpace: "normal",
                    }}>{hook.body}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Safety policy */}
          <div className="rd-card rd-card__pad">
            <div className="rd-eyebrow">Safety policy</div>
            <div className="rd-stack" style={{ gap: 8, marginTop: 10 }}>
              <PolicySwitch
                label="Auto-save explicit remember-this"
                checked={policies.autoSaveExplicit}
                onChange={(v) => updatePolicy("autoSaveExplicit", v)}
              />
              <PolicySwitch
                label="Suggest low-risk preferences"
                checked={policies.suggestLowRisk}
                onChange={(v) => updatePolicy("suggestLowRisk", v)}
              />
              <PolicySwitch
                label="Require diff for privacy, budget, connectors"
                checked={policies.diffPrivacy}
                onChange={(v) => updatePolicy("diffPrivacy", v)}
              />
            </div>
            <div className="rd-row" style={{ gap: 6, marginTop: 12 }}>
              <button className="rd-btn rd-btn--primary rd-btn--sm" onClick={() => previewAction("Review policy")}>Review policy</button>
              <button className="rd-btn rd-btn--quiet rd-btn--sm" onClick={() => previewAction("Open activity log")}>Activity log</button>
            </div>
          </div>
        </aside>
      </div>

      {/* Behind the scenes — Style Profile + runtime implementation, secondary attention */}
      <details className="rd-card rd-card__pad" style={{ background: "var(--rd-paper-warm)" }}>
        <summary style={{
          cursor: "pointer",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--rd-ink-soft)",
          listStyle: "none",
        }}>
          ▸ Style Profile · How NodeBench writes when it writes for you
        </summary>
        <div style={{ marginTop: 14 }}>
          <StyleProfileSection />
        </div>
      </details>

      <details className="rd-card rd-card__pad" style={{ background: "var(--rd-paper-warm)" }}>
        <summary style={{
          cursor: "pointer",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--rd-ink-soft)",
          listStyle: "none",
        }}>
          ▸ Runtime · How USER.md powers reports, chats, and agents
        </summary>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, marginTop: 14 }} className="me-runtime-grid">
          <RuntimeCard
            kicker="How NodeBench sees you"
            title="Founder / banker lens"
            body="Concise, evidence-led, report-first. Avoid generic corporate tone."
            primaryAction="Edit profile"
            secondaryAction="Recompute from USER.md"
            editable
          />
          <RuntimeCard
            kicker="Existing runtime"
            title="product.me profile"
            body="Uses getMeSnapshot, updateProfile, listFiles, and saved context counts."
            primaryAction="Inspect getMeSnapshot"
            secondaryAction="Open saved context"
          />
          <RuntimeCard
            kicker="Editable source"
            title="USER.md document"
            body="Markdown stored through operatorProfile and parsed into permissions, budget, and output preferences."
            primaryAction="Open editor"
            secondaryAction="Validate parser"
            highlight
          />
        </div>
      </details>

      {/* Plan + Integrations footer row (preserves locked Me shell) */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }} className="me-footer-grid">
        <section className="rd-card rd-card__pad">
          <div className="rd-row--between">
            <div>
              <div className="rd-eyebrow">Plan + credits</div>
              <h4 style={{ margin: "6px 0 0", fontSize: 14, fontWeight: 590 }}>Founder · $49/mo</h4>
              <p className="rd-faint" style={{ margin: "2px 0 0", fontSize: 12 }}>8 external research runs used / 200</p>
            </div>
            <Pill tone="green">Active</Pill>
          </div>
          <div style={{ height: 4, background: "var(--rd-line)", borderRadius: 2, marginTop: 12, overflow: "hidden" }}>
            <div style={{ width: "4%", height: "100%", background: "var(--rd-accent)" }} />
          </div>
        </section>
        <section className="rd-card rd-card__pad">
          <div className="rd-eyebrow">Integrations</div>
          <div className="rd-stack" style={{ gap: 6, marginTop: 10 }}>
            {[
              { name: "HubSpot", connected: true },
              { name: "Notion", connected: true },
              { name: "Linear", connected: false },
              { name: "Slack", connected: false },
              { name: "Gmail", connected: false },
            ].map((it) => (
              <div key={it.name} className="rd-row--between" style={{ fontSize: 12.5 }}>
                <span>{it.name}</span>
                <Pill tone={it.connected ? "green" : undefined}>
                  {it.connected ? "Connected" : "Connect"}
                </Pill>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function MeV2DocumentCenter({
  mode,
  sections,
  savedAt,
  patch,
  onPrimary,
  onPatch,
  onRejectPatch,
}: {
  mode: "loading" | "guest" | "authenticated";
  sections: Section[];
  savedAt: string;
  patch?: string;
  onPrimary: () => void;
  onPatch?: () => void;
  onRejectPatch?: () => void;
}) {
  const guest = mode !== "authenticated";
  const lines = guest
    ? [
        ["# Private Context", ""],
        ["Profile:", mode === "loading" ? "Resolving private session." : "No signed-in profile is loaded."],
        ["Memory:", "Watched entities, writing style, connector permissions, and budget rules are hidden until sign-in."],
        ["Agent rule:", "No private captures, account names, connector rows, or prior profile data are rendered to public visitors."],
        ["Next action:", mode === "loading" ? "Wait for auth resolution." : "Sign in to create a private USER.md file."],
      ]
    : sections.flatMap((section) => [
        [section.heading, ""],
        ["Policy:", section.permissions.filter((permission) => permission.pressed).map((permission) => PERM_LABEL[permission.id]).join(", ") || "review required"],
        ["Memory:", section.body],
      ]);

  return (
    <div className="rd-v2-proto-center rd-v2-me-center">
      <div className="rd-v2-edition-row">
        <span className="rd-v2-edition-pill">USER.md</span>
        <span className="rd-v2-edition-subline">{guest ? savedAt : `Your identity file · ${savedAt}`}</span>
      </div>
      <div className="rd-v2-share-bar">
        <span>Actions</span>
        {!guest && (
          <button type="button" className="rd-v2-share-primary" onClick={onPrimary}>Save</button>
        )}
        <button type="button" onClick={() => showToast({ tone: "info", message: guest ? "Exports unlock after sign-in." : "Export preview is local until connector approval." })}>Export</button>
        {!guest && (
          <button type="button" onClick={() => showToast({ tone: "info", message: "Reset requires diff review before mutating USER.md." })}>Reset</button>
        )}
      </div>
      <article className="rd-v2-user-md">
        {lines.map(([key, value], index) => (
          key.startsWith("#") ? <h2 key={`${key}-${index}`}>{key}</h2> : (
            <p key={`${key}-${index}`}>
              <span>{key}</span> {value}
            </p>
          )
        ))}
        {guest && (
          <button
            type="button"
            className="rd-btn rd-btn--primary"
            style={{ marginTop: 16, alignSelf: "flex-start" }}
            onClick={onPrimary}
          >
            Sign in to unlock
          </button>
        )}
      </article>
      {patch && !guest && (
        <section className="rd-card rd-card__pad" style={{ background: "var(--rd-paper-warm)" }}>
          <div className="rd-eyebrow">Suggested patch</div>
          <p className="rd-faint" style={{ marginTop: 8 }}>{patch}</p>
          <div className="rd-row" style={{ gap: 8, marginTop: 12 }}>
            <button type="button" className="rd-btn rd-btn--primary rd-btn--sm" onClick={onPatch}>Accept</button>
            <button type="button" className="rd-btn rd-btn--quiet rd-btn--sm" onClick={onRejectPatch}>Reject</button>
          </div>
        </section>
      )}
      <section className="rd-v2-integrations-grid">
        {[
          ["GitHub", guest ? "Connect after sign-in" : "Available", guest ? "No repository memory shown" : "Repository context can be indexed"],
          ["Runtime", guest ? "Public read only" : "Connected runtime", guest ? "No private tables exposed" : "Live profile writes stay gated"],
          ["LinkedIn", "Approval required", "Posting and CRM writes require review"],
          ["Slack", guest ? "Off" : "Optional", "Team memory stays permission-scoped"],
        ].map(([name, status, detail]) => {
          const tone = /connected|available/i.test(status as string) ? "green"
            : /off|disabled/i.test(status as string) ? "mute"
            : /approval|review|connect/i.test(status as string) ? "amber"
            : "green";
          return (
            <article key={name}>
              <strong>{name}</strong>
              <span data-tone={tone}>{status}</span>
              <p>{detail}</p>
            </article>
          );
        }
        )}
        {/* Step 9 of scratchnode release loop — ScratchNode handoff entry
            point. Keeps the integrations grid as the canonical "linked apps"
            surface (per the audit's request to add the surface under Me).
            Link wins because ScratchNode is the FIRST sibling app on the
            shared Convex deployment; it is the prototype for cross-app
            handoff inside the NodeBench identity. */}
        <article data-testid="me-integration-scratchnode">
          <strong>ScratchNode</strong>
          <span data-tone="green">Linked via session</span>
          <p>
            <a
              href="/scratchnode-events"
              data-testid="me-integration-scratchnode-link"
              style={{ color: "var(--rd-accent-strong)", textDecoration: "none" }}
            >
              View joined events &amp; private notes →
            </a>
          </p>
        </article>
      </section>
    </div>
  );
}

function CompletenessMeter({ sections }: { sections: Section[] }) {
  const pct = useMemo(() => {
    let score = 0;
    for (const s of sections) {
      if (s.body.trim().length > 60) score += 18;       // 18 per filled body
      if (s.permissions.some((p) => p.pressed)) score += 7; // 7 if at least 1 perm enabled
    }
    return Math.min(100, score);
  }, [sections]);
  const tier = pct < 40 ? "Just getting started" : pct < 75 ? "Solid baseline" : "Comprehensive context";
  return (
    <div className="rd-me-meter" role="status" aria-label={`Profile completeness ${pct}%`}>
      <span className="rd-eyebrow" style={{ flexShrink: 0 }}>Profile</span>
      <div className="rd-me-meter__bar">
        <div className="rd-me-meter__fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="rd-me-meter__pct">{pct}%</span>
      <span className="rd-mono" style={{ fontSize: 10.5, color: "var(--rd-ink-soft)" }}>· {tier}</span>
    </div>
  );
}

function exportUserMd(sections: Section[]) {
  const today = new Date().toISOString().slice(0, 10);
  const lines: string[] = [];
  lines.push("---");
  lines.push("# USER.md — NodeBench operator manifest");
  lines.push(`# exported_at: ${today}`);
  lines.push("---");
  lines.push("");
  for (const s of sections) {
    lines.push(s.heading);
    lines.push("");
    lines.push(s.body);
    lines.push("");
    if (s.permissions.length > 0) {
      lines.push("> permissions: " + s.permissions.filter((p) => p.pressed).map((p) => p.id).join(", "));
      lines.push("");
    }
  }
  const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `USER-${today}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast({ tone: "success", message: `Exported USER-${today}.md to downloads.` });
}

function StyleProfileSection() {
  const inferred = memoStyles.find((s) => s.id === "user.inferred")!;
  const publics = memoStyles.filter((s) => s.id !== "user.inferred");
  const [active, setActive] = useState<MemoStyle>(inferred);
  const [showGallery, setShowGallery] = useState(false);

  return (
    <section aria-label="Your style profile" className="rd-stack" style={{ gap: 12 }}>
      <header className="rd-row--between" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
        <p className="rd-faint" style={{ fontSize: 12.5, maxWidth: 540, margin: 0 }}>
          The operator's manifest derived from your USER.md and recent edits. Drives how every report and chat reads.
        </p>
        <div className="rd-row" style={{ gap: 6 }}>
          <button className="rd-btn rd-btn--quiet rd-btn--sm" onClick={() => setShowGallery((v) => !v)}>
            {showGallery ? "Hide gallery" : "Browse public styles"}
          </button>
          <button className="rd-btn rd-btn--quiet rd-btn--sm" onClick={() => showToast({ tone: "info", message: "Style recompute preview queued locally." })}>Recompute preview</button>
          <button className="rd-btn rd-btn--primary rd-btn--sm" onClick={() => showToast({ tone: "success", message: "Style profile saved locally for this session." })}>Save locally</button>
        </div>
      </header>

      {/* Inferred style hero */}
      <article
        className="rd-card rd-card__pad"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)",
          gap: 24,
          background: "linear-gradient(135deg, var(--rd-accent-tint), var(--rd-paper))",
          borderColor: "var(--rd-accent-ring)",
        }}
      >
        <div className="rd-stack" style={{ gap: 10 }}>
          <div className="rd-row" style={{ gap: 6, flexWrap: "wrap" }}>
            <Pill tone="accent">{active.name}</Pill>
            {active.confidence && <Pill tone="green">{Math.round(active.confidence * 100)}% match</Pill>}
            <span className="rd-mono" style={{ fontSize: 10.5, color: "var(--rd-ink-soft)" }}>{active.source}</span>
          </div>
          <p className="rd-body" style={{ fontSize: 14, color: "var(--rd-ink)" }}>{active.voice}</p>

          <div>
            <div className="rd-eyebrow" style={{ marginBottom: 6 }}>Section structure</div>
            <ol style={{ margin: 0, padding: "0 0 0 18px", fontSize: 12.5, lineHeight: 1.6, color: "var(--rd-ink-mute)" }}>
              {active.sectionOrder.map((s) => <li key={s}>{s}</li>)}
            </ol>
          </div>

          <div>
            <div className="rd-eyebrow" style={{ marginBottom: 6 }}>Recommendation phrasings</div>
            <div className="rd-row" style={{ gap: 4, flexWrap: "wrap" }}>
              {active.recommendationPhrasings.map((p) => (
                <code key={p} style={{
                  fontFamily: "var(--rd-font-mono)", fontSize: 11,
                  background: "var(--rd-panel)", border: "1px solid var(--rd-line)",
                  borderRadius: 4, padding: "1px 6px", color: "var(--rd-ink-mute)",
                }}>{p}</code>
              ))}
            </div>
          </div>

          <div>
            <div className="rd-eyebrow" style={{ marginBottom: 6 }}>Risk lens · source preferences</div>
            <div className="rd-row" style={{ gap: 4, flexWrap: "wrap" }}>
              {active.riskLens.map((r) => <Pill key={r}>{r}</Pill>)}
              {active.sourcePreferences.map((s) => <Pill key={s} tone="blue">{s}</Pill>)}
            </div>
          </div>
        </div>

        {/* Provenance — what trained this style */}
        <aside className="rd-stack" style={{ gap: 8 }}>
          <div className="rd-eyebrow">Derived from</div>
          {inferredStyleProvenance.map((p) => (
            <div key={p.sourceLabel} className="rd-card rd-card__pad-tight" style={{ background: "var(--rd-panel)" }}>
              <div className="rd-row--between" style={{ marginBottom: 4 }}>
                <span style={{ fontSize: 12, color: "var(--rd-ink-strong)", fontWeight: 590 }}>{p.sourceLabel}</span>
                <span className="rd-mono" style={{ fontSize: 10, color: "var(--rd-accent-strong)" }}>{p.weightPct}%</span>
              </div>
              <div style={{ height: 4, background: "var(--rd-line)", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ width: `${p.weightPct}%`, height: "100%", background: "var(--rd-accent)" }} />
              </div>
              <div className="rd-mono" style={{ fontSize: 10, color: "var(--rd-ink-soft)", marginTop: 4 }}>
                {p.patterns} patterns extracted
              </div>
            </div>
          ))}
          <div className="rd-card rd-card__pad-tight" style={{ background: "var(--rd-paper-warm)", borderStyle: "dashed" }}>
            <div className="rd-eyebrow" style={{ marginBottom: 4 }}>Bring your own</div>
            <p style={{ fontSize: 11.5, color: "var(--rd-ink-soft)", margin: 0 }}>
              Drop 3-10 of your best memos to refine the manifest. Files stay client-side until you opt in.
            </p>
          </div>
        </aside>
      </article>

      {/* Style gallery (toggle) */}
      {showGallery && (
        <div>
          <div className="rd-eyebrow" style={{ marginBottom: 8 }}>Public styles · click to swap</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 10 }}>
            {publics.map((s) => (
              <StyleGalleryCard
                key={s.id}
                style={s}
                selected={s.id === active.id}
                onSelect={(st) => setActive(st)}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function RuntimeCard({
  kicker, title, body, primaryAction, secondaryAction, editable, highlight,
}: {
  kicker: string;
  title: string;
  body: string;
  primaryAction: string;
  secondaryAction: string;
  editable?: boolean;
  highlight?: boolean;
}) {
  return (
    <div className="rd-card" style={{
      padding: 14,
      minHeight: 158,
      borderColor: highlight ? "var(--rd-accent-ring)" : undefined,
      background: highlight ? "var(--rd-accent-tint)" : undefined,
    }}>
      <div className="rd-eyebrow" style={{ color: highlight ? "var(--rd-accent-strong)" : undefined }}>{kicker}</div>
      {editable ? (
        <h4
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-label={`Edit ${title}`}
          style={{
            margin: "6px 0 4px", fontSize: 16, fontWeight: 590, color: "var(--rd-ink-strong)",
            padding: "2px 4px", borderRadius: 6, border: "1px solid transparent", outline: "none",
          }}
        >{title}</h4>
      ) : (
        <button type="button" style={{
          display: "block", margin: "6px 0 4px", padding: "2px 4px",
          fontSize: 16, fontWeight: 590, color: "var(--rd-ink-strong)",
          background: "transparent", border: "1px solid transparent", borderRadius: 6, cursor: "pointer",
          textAlign: "left", fontFamily: "inherit",
        }}>{title}</button>
      )}
      <p
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-label={`Edit ${title} body`}
        style={{
          fontSize: 13, lineHeight: 1.5, color: "var(--rd-ink-mute)",
          margin: 0, padding: "5px 6px", borderRadius: 8,
          border: "1px solid transparent", outline: "none",
          minHeight: 38,
        }}
      >{body}</p>
      <div className="rd-row" style={{ gap: 6, marginTop: 10, flexWrap: "wrap" }}>
        <button className="rd-btn rd-btn--ghost rd-btn--sm" style={{
          background: "var(--rd-accent-soft)",
          color: "var(--rd-accent-strong)",
          border: "1px solid var(--rd-accent-ring)",
        }} onClick={() => showToast({ tone: "info", message: `${primaryAction} is a local runtime preview.` })}>{primaryAction}</button>
        <button className="rd-btn rd-btn--quiet rd-btn--sm" onClick={() => showToast({ tone: "info", message: `${secondaryAction} is a local runtime preview.` })}>{secondaryAction}</button>
      </div>
    </div>
  );
}

function SaveStatePill({ state }: { state: string }) {
  const isSaving = state.toLowerCase().includes("saving");
  return (
    <span
      role="status"
      aria-live="polite"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 10px",
        borderRadius: "var(--rd-r-pill)",
        border: `1px solid ${isSaving ? "var(--rd-amber)" : "var(--rd-green-border)"}`,
        background: isSaving ? "var(--rd-amber-bg)" : "var(--rd-green-bg)",
        color: isSaving ? "var(--rd-amber)" : "var(--rd-green)",
        fontFamily: "var(--rd-font-mono)",
        fontSize: 11,
        fontWeight: 700,
      }}
    >
      <span style={{
        width: 7, height: 7, borderRadius: 999,
        background: isSaving ? "var(--rd-amber)" : "var(--rd-green)",
        boxShadow: isSaving ? "0 0 0 3px rgba(178, 98, 0, 0.12)" : "0 0 0 3px rgba(2,122,72,0.12)",
      }} />
      {state}
    </span>
  );
}

function PolicySwitch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="rd-row--between" style={{
      gap: 10,
      padding: "8px 10px",
      border: "1px solid var(--rd-line)",
      borderRadius: 12,
      background: "var(--rd-panel)",
      color: "var(--rd-ink-mute)",
      fontSize: 12,
      fontWeight: 510,
      cursor: "pointer",
    }}>
      <span style={{ flex: 1, minWidth: 0 }}>{label}</span>
      <input
        type="checkbox"
        className="rd-policy-switch__input"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
