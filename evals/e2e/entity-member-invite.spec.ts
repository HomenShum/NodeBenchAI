import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  appendToNotebookBlock,
  NOTEBOOK_ENTITY_NAME,
  NOTEBOOK_ENTITY_SLUG,
  openEntityLiveNotebook,
  pageWait,
  primeSharedProductSession,
  PRODUCT_ANON_SESSION_KEY,
  resetProductState,
  seedEntityNoteDocument,
  seedNotebookEntity,
} from "./helpers/entityNotebook";

async function signUpInScope(scope: Locator | Page, email: string, password: string) {
  const signUpInstead = scope.getByRole("button", { name: /sign up instead/i }).first();
  if (await signUpInstead.isVisible().catch(() => false)) {
    await signUpInstead.click();
  }
  await scope.getByPlaceholder("Email").fill(email);
  await scope.getByPlaceholder("Password").fill(password);
  await scope.getByRole("button", { name: /^sign up$/i }).click();
}

async function readInviteUrl(page: Page, inviteeEmail: string) {
  const initialClipboard = await page
    .evaluate(async () => navigator.clipboard.readText())
    .catch(() => "");
  if (initialClipboard.includes("?invite=") || initialClipboard.includes("?share=")) {
    return initialClipboard;
  }

  const row = page
    .locator('[data-testid^="entity-share-invite-"], [data-testid^="entity-share-member-"]')
    .filter({ hasText: inviteeEmail })
    .first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.getByRole("button", { name: /copy link/i }).click();
  return await page.evaluate(async () => navigator.clipboard.readText());
}

test.describe("Entity workspace member invites", () => {
  test("owner can invite a named collaborator who joins and edits as a member", async ({ browser }) => {
    test.setTimeout(7 * 60 * 1000);

    const timestamp = Date.now();
    const ownerSessionId = `pw-owner-member-${timestamp}`;
    const memberSessionId = `pw-member-${timestamp}`;
    const ownerEmail = `owner+${timestamp}@example.test`;
    const memberEmail = `member+${timestamp}@example.test`;
    const password = `Nodebench!${timestamp}`;
    const notebookMarker = ` [member-edit-${timestamp.toString(36)}]`;

    const ownerContext = await browser.newContext({
      permissions: ["clipboard-read", "clipboard-write"],
    });
    const memberContext = await browser.newContext({
      permissions: ["clipboard-read", "clipboard-write"],
    });

    try {
      await primeSharedProductSession(ownerContext, ownerSessionId, {
        entitySlug: NOTEBOOK_ENTITY_SLUG,
        entityViewMode: "classic",
      });
      await primeSharedProductSession(memberContext, memberSessionId, {
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
        "SoftBank member workspace",
        "Member collaboration seed",
        "Members should be able to edit this workspace after invite acceptance.",
        "Next step seed",
      ]);
      await seedEntityNoteDocument(
        ownerSessionId,
        "## SoftBank\n\nNamed members should be able to extend this workspace after joining.",
      );

      await openEntityLiveNotebook(ownerPage, NOTEBOOK_ENTITY_SLUG, 4, NOTEBOOK_ENTITY_NAME);
      await ownerPage.getByRole("button", { name: "Share" }).click();
      const ownerShareSheet = ownerPage.getByTestId("entity-share-sheet");
      await expect(ownerShareSheet).toBeVisible({ timeout: 20_000 });
      await signUpInScope(ownerShareSheet, ownerEmail, password);

      await pageWait(ownerPage, 3_000);
      await ownerPage.reload({ waitUntil: "domcontentloaded" });
      await openEntityLiveNotebook(ownerPage, NOTEBOOK_ENTITY_SLUG, 4, NOTEBOOK_ENTITY_NAME);
      await ownerPage.getByRole("button", { name: "Share" }).click();
      await expect(ownerPage.getByTestId("entity-share-invite-email")).toBeVisible({
        timeout: 60_000,
      });
      await expect(ownerPage.getByTestId("entity-share-empty-state")).toContainText(
        "Invite your first collaborator",
      );

      await ownerPage.getByTestId("entity-share-invite-email").fill(memberEmail);
      await ownerPage.getByTestId("entity-share-invite-access").selectOption("edit");
      await ownerPage.getByTestId("entity-share-invite-submit").click();
      await expect(
        ownerPage
          .locator('[data-testid^="entity-share-invite-"], [data-testid^="entity-share-member-"]')
          .filter({ hasText: memberEmail })
          .first(),
      ).toBeVisible({ timeout: 30_000 });
      await expect(
        ownerPage.getByText(/Email sent|secure link ready|Email unavailable/i).first(),
      ).toBeVisible({ timeout: 30_000 });

      const inviteUrl = await readInviteUrl(ownerPage, memberEmail);
      expect(inviteUrl).toMatch(new RegExp(`/entity/${NOTEBOOK_ENTITY_SLUG}\\?(invite|share)=`));

      const memberPage = await memberContext.newPage();
      await memberPage.goto(inviteUrl, { waitUntil: "domcontentloaded" });
      await expect(memberPage.getByText(`Join ${NOTEBOOK_ENTITY_NAME}`)).toBeVisible({
        timeout: 30_000,
      });

      await signUpInScope(memberPage, memberEmail, password);
      await expect(memberPage.getByRole("button", { name: "Join workspace" })).toBeVisible({
        timeout: 60_000,
      });
      await memberPage.getByRole("button", { name: "Join workspace" }).click();

      await expect(memberPage).toHaveURL(new RegExp(`/entity/${NOTEBOOK_ENTITY_SLUG}\\?share=`), {
        timeout: 60_000,
      });
      await expect(memberPage.getByRole("button", { name: "Share" })).toHaveCount(0);

      const shareToken = new URL(memberPage.url()).searchParams.get("share") ?? undefined;
      const memberLive = await openEntityLiveNotebook(
        memberPage,
        NOTEBOOK_ENTITY_SLUG,
        4,
        NOTEBOOK_ENTITY_NAME,
        shareToken,
      );
      await expect(memberLive.reportRegion.getByRole("status")).not.toContainText("Read-only", {
        timeout: 20_000,
      });
      await appendToNotebookBlock(memberPage, memberLive.reportRegion, 2, notebookMarker);
      await pageWait(memberPage, 2_000);

      await memberPage.reload({ waitUntil: "domcontentloaded" });
      const reloadedLive = await openEntityLiveNotebook(
        memberPage,
        NOTEBOOK_ENTITY_SLUG,
        4,
        NOTEBOOK_ENTITY_NAME,
        shareToken,
      );
      await expect(
        reloadedLive.blocks.nth(2).locator('[role="textbox"]').first(),
      ).toContainText(notebookMarker, { timeout: 20_000 });
    } finally {
      await Promise.allSettled([ownerContext.close(), memberContext.close()]);
    }
  });
});
