import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RichNotebookEditor } from "./RichNotebookEditor";

afterEach(() => {
  cleanup();
});

describe("RichNotebookEditor — claim blocks (kit-parity nb_claim)", () => {
  const claim = {
    statement: "ACH pricing change widens take rate vs. wire transfer parity.",
    support: 3,
    conflict: 1,
    open: true,
    evidence: [
      { n: 1, label: "Stripe pricing memo (2026-04)", kind: "support" as const },
      { n: 2, label: "Anonymous customer churn signal", kind: "support" as const },
      { n: 3, label: "Treasury index report q1", kind: "support" as const },
      { n: 4, label: "Internal margin model", kind: "conflict" as const },
    ],
  };

  it("Scenario: claim renders with statement, support/conflict pills, and evidence list when open", async () => {
    render(
      <RichNotebookEditor
        initialContent="<h2>Notebook</h2><p>x</p>"
        claims={[claim]}
      />,
    );

    await waitFor(() => {
      expect(document.querySelector('[data-type="nb-claim"]')).not.toBeNull();
    });

    const claimRoot = document.querySelector('[data-type="nb-claim"]') as HTMLElement;
    expect(claimRoot.textContent).toContain(claim.statement);
    expect(claimRoot.textContent).toContain("3 support");
    expect(claimRoot.textContent).toContain("1 conflict");

    // Evidence visible while open.
    for (const ev of claim.evidence) {
      expect(claimRoot.textContent).toContain(ev.label);
    }
  });

  it("Scenario: claim head is keyboard-accessible (role=button, aria-expanded toggles)", async () => {
    const user = userEvent.setup();
    render(
      <RichNotebookEditor
        initialContent="<p>x</p>"
        claims={[{ ...claim, open: true }]}
      />,
    );

    const head = await waitFor(() => {
      const el = document.querySelector('[data-type="nb-claim"] [role="button"]');
      if (!el) throw new Error("claim head not yet rendered");
      return el as HTMLElement;
    });

    expect(head.getAttribute("aria-expanded")).toBe("true");

    // Click to collapse.
    await user.click(head);
    await waitFor(() => expect(head.getAttribute("aria-expanded")).toBe("false"));

    // Evidence list hidden when collapsed.
    expect(
      document.querySelector('[data-type="nb-claim"] .nb-claim-evidence'),
    ).toBeNull();

    // Press Enter on focused head to re-expand.
    head.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(head.getAttribute("aria-expanded")).toBe("true"));
  });

  it("Scenario: claim seeded as collapsed (open:false) — evidence hidden until clicked", async () => {
    const user = userEvent.setup();
    render(
      <RichNotebookEditor
        initialContent="<p>x</p>"
        claims={[{ ...claim, open: false }]}
      />,
    );

    const head = await waitFor(() => {
      const el = document.querySelector('[data-type="nb-claim"] [role="button"]');
      if (!el) throw new Error("claim head not yet rendered");
      return el as HTMLElement;
    });

    expect(head.getAttribute("aria-expanded")).toBe("false");
    expect(
      document.querySelector('[data-type="nb-claim"] .nb-claim-evidence'),
    ).toBeNull();

    await user.click(head);
    await waitFor(() => expect(head.getAttribute("aria-expanded")).toBe("true"));
    expect(
      document.querySelector('[data-type="nb-claim"] .nb-claim-evidence'),
    ).not.toBeNull();
  });

  it("Scenario: claim with no evidence — open state shows no evidence list, doesn't crash", async () => {
    render(
      <RichNotebookEditor
        initialContent="<p>x</p>"
        claims={[{ ...claim, evidence: [], open: true }]}
      />,
    );

    await waitFor(() => {
      expect(document.querySelector('[data-type="nb-claim"]')).not.toBeNull();
    });
    // Statement still visible; no evidence rows.
    expect(
      document.querySelector('[data-type="nb-claim"]')!.textContent,
    ).toContain(claim.statement);
    expect(
      document.querySelectorAll('[data-type="nb-claim"] .nb-claim-ev').length,
    ).toBe(0);
  });

  it("Scenario: support and conflict evidence carry correct data-kind for downstream filtering", async () => {
    render(
      <RichNotebookEditor
        initialContent="<p>x</p>"
        claims={[claim]}
      />,
    );

    const evRows = await waitFor(() => {
      const rows = document.querySelectorAll('[data-type="nb-claim"] .nb-claim-ev');
      if (rows.length === 0) throw new Error("evidence not yet rendered");
      return Array.from(rows) as HTMLElement[];
    });

    const kinds = evRows.map((row) => row.getAttribute("data-kind"));
    expect(kinds).toEqual(["support", "support", "support", "conflict"]);
  });
});
