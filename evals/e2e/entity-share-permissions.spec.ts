import { expect, test } from "@playwright/test";
import {
  appendToNotebookBlock,
  createEntityWorkspaceShare,
  NOTEBOOK_ENTITY_SLUG,
  openEntityLiveNotebook,
  pageWait,
  primeSharedProductSession,
  PRODUCT_ANON_SESSION_KEY,
  resetProductState,
  revokeEntityWorkspaceShare,
  seedEntityNoteDocument,
  seedNotebookEntity,
} from "./helpers/entityNotebook";

test.describe("Entity workspace sharing", () => {
  test("view share stays read-only and revoked links stop opening", async ({ browser }) => {
    test.setTimeout(4 * 60 * 1000);

    const ownerSessionId = `pw-owner-view-${Date.now()}`;
    const viewerSessionId = `pw-viewer-${Date.now()}`;

    const ownerContext = await browser.newContext();
    const viewerContext = await browser.newContext();

    try {
      await primeSharedProductSession(ownerContext, ownerSessionId, {
        entitySlug: NOTEBOOK_ENTITY_SLUG,
        entityViewMode: "classic",
      });
      await primeSharedProductSession(viewerContext, viewerSessionId, {
        entitySlug: NOTEBOOK_ENTITY_SLUG,
        entityViewMode: "classic",
      });

      const ownerPage = await ownerContext.newPage();
      await resetProductState(ownerPage);
      await ownerPage.evaluate(
        ([storageKey, sessionId]) => {
          window.localStorage.setItem(storageKey, sessionId);
          window.sessionStorage.setItem(storageKey, sessionId);
        },
        [PRODUCT_ANON_SESSION_KEY, ownerSessionId],
      );
      await seedNotebookEntity(ownerSessionId, [
        "SoftBank shared workspace",
        "Signals seed for shared viewers",
        "Shared viewers should only read this notebook.",
        "Next step seed",
      ]);
      await seedEntityNoteDocument(
        ownerSessionId,
        "## SoftBank\n\nThis is the owner note for the shared read-only workspace.",
      );
      const viewToken = await createEntityWorkspaceShare(ownerSessionId, "view");

      await openEntityLiveNotebook(ownerPage, NOTEBOOK_ENTITY_SLUG, 4, "SoftBank");
      await ownerPage.getByRole("button", { name: "Share" }).click();
      await expect(ownerPage.getByTestId("entity-share-sheet")).toBeVisible({ timeout: 10_000 });
      await expect(ownerPage.getByTestId("entity-share-copy-view")).toContainText("Copy link");
      await expect(ownerPage.getByTestId("entity-share-revoke-view")).toBeVisible();

      const viewerPage = await viewerContext.newPage();
      const viewerLive = await openEntityLiveNotebook(
        viewerPage,
        NOTEBOOK_ENTITY_SLUG,
        4,
        "SoftBank",
        viewToken,
      );
      await expect(viewerPage.getByRole("button", { name: "Share" })).toHaveCount(0);
      await expect(viewerLive.reportRegion.getByRole("status")).toContainText("Read-only", {
        timeout: 20_000,
      });
      await expect(viewerLive.reportRegion.locator('.ProseMirror[contenteditable="true"]')).toHaveCount(0);

      await revokeEntityWorkspaceShare(ownerSessionId, "view");
      await viewerPage.reload({ waitUntil: "domcontentloaded" });
      await expect(viewerPage.getByText("This share link is unavailable.")).toBeVisible({
        timeout: 20_000,
      });
    } finally {
      await Promise.allSettled([ownerContext.close(), viewerContext.close()]);
    }
  });

  test("edit share can update notes and the live notebook from another session", async ({ browser }) => {
    test.setTimeout(5 * 60 * 1000);

    const ownerSessionId = `pw-owner-edit-${Date.now()}`;
    const editorSessionId = `pw-editor-${Date.now()}`;
    const notebookMarker = ` [shared-edit-${Date.now().toString(36)}]`;

    const ownerContext = await browser.newContext();
    const editorContext = await browser.newContext();

    try {
      await primeSharedProductSession(ownerContext, ownerSessionId, {
        entitySlug: NOTEBOOK_ENTITY_SLUG,
        entityViewMode: "classic",
      });
      await primeSharedProductSession(editorContext, editorSessionId, {
        entitySlug: NOTEBOOK_ENTITY_SLUG,
        entityViewMode: "classic",
      });

      const ownerPage = await ownerContext.newPage();
      await resetProductState(ownerPage);
      await ownerPage.evaluate(
        ([storageKey, sessionId]) => {
          window.localStorage.setItem(storageKey, sessionId);
          window.sessionStorage.setItem(storageKey, sessionId);
        },
        [PRODUCT_ANON_SESSION_KEY, ownerSessionId],
      );
      await seedNotebookEntity(ownerSessionId, [
        "SoftBank edit workspace",
        "Editable section seed",
        "Editable body seed for shared edit verification.",
        "Wrap-up seed",
      ]);
      await seedEntityNoteDocument(
        ownerSessionId,
        "## SoftBank\n\nShared editors should be able to extend this note.",
      );
      const editToken = await createEntityWorkspaceShare(ownerSessionId, "edit");

      const editorPage = await editorContext.newPage();
      const liveNotebook = await openEntityLiveNotebook(
        editorPage,
        NOTEBOOK_ENTITY_SLUG,
        4,
        "SoftBank",
        editToken,
      );
      await expect(liveNotebook.reportRegion.getByRole("status")).not.toContainText("Read-only", {
        timeout: 20_000,
      });
      await appendToNotebookBlock(editorPage, liveNotebook.reportRegion, 2, notebookMarker);
      await pageWait(editorPage, 2_000);

      await editorPage.reload({ waitUntil: "domcontentloaded" });
      const reloadedLive = await openEntityLiveNotebook(
        editorPage,
        NOTEBOOK_ENTITY_SLUG,
        4,
        "SoftBank",
        editToken,
      );
      await expect(
        reloadedLive.blocks.nth(2).locator('[role="textbox"]').first(),
      ).toContainText(notebookMarker, { timeout: 20_000 });
    } finally {
      await Promise.allSettled([ownerContext.close(), editorContext.close()]);
    }
  });
});
