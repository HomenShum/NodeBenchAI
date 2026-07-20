import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import {
  appendToNotebookBlock,
  focusNotebookBlock,
  NOTEBOOK_ENTITY_SLUG,
  openEntityLiveNotebook,
  pageWait,
  primeSharedProductSession,
  PRODUCT_ANON_SESSION_KEY,
  resetProductState,
  seedNotebookEntity,
} from "./helpers/entityNotebook";

test.describe("Entity notebook regression", () => {
  test("live notebook blocks stay in sync after reload", async ({ page }) => {
    test.setTimeout(2 * 60 * 1000);

    await resetProductState(page);
    const sharedSessionId = `pw-reload-${Date.now()}`;
    await page.evaluate(
      ([storageKey, sessionId]) => {
        window.localStorage.setItem(storageKey, sessionId);
        window.sessionStorage.setItem(storageKey, sessionId);
      },
      [PRODUCT_ANON_SESSION_KEY, sharedSessionId],
    );
    await seedNotebookEntity(sharedSessionId, [
      "SoftBank live notebook",
      "Signals block seed",
      "Body block seed with enough content to verify persistence after reload.",
      "Next actions seed",
    ]);

    const { reportRegion, blocks } = await openEntityLiveNotebook(page, NOTEBOOK_ENTITY_SLUG);

    const liveHeading = blocks.nth(0).locator('[role="textbox"]').first();
    const liveSectionHeading = blocks.nth(1).locator('[role="textbox"]').first();
    const liveBody = blocks.nth(2).locator('[role="textbox"]').first();

    const sectionHeadingBeforeReload = (await liveSectionHeading.textContent())?.trim() ?? "";
    const bodyBeforeReload = (await liveBody.textContent())?.trim() ?? "";

    await expect(liveHeading).toContainText("SoftBank live notebook");
    expect(sectionHeadingBeforeReload.length).toBeGreaterThan(3);
    expect(bodyBeforeReload.length).toBeGreaterThan(40);

    await page.reload({ waitUntil: "domcontentloaded" });

    const { blocks: reloadedBlocks } = await openEntityLiveNotebook(page, NOTEBOOK_ENTITY_SLUG);
    await expect(reloadedBlocks.nth(0).locator('[role="textbox"]').first()).toContainText(
      "SoftBank live notebook",
    );
    await expect(reloadedBlocks.nth(1).locator('[role="textbox"]').first()).toHaveText(sectionHeadingBeforeReload);
    await expect(reloadedBlocks.nth(2).locator('[role="textbox"]').first()).toContainText(bodyBeforeReload);
  });

  test("enter creates the next live block and keeps typing there", async ({ page }) => {
    test.setTimeout(2 * 60 * 1000);

    await resetProductState(page);
    const sharedSessionId = `pw-enter-${Date.now()}`;
    await page.evaluate(
      ([storageKey, sessionId]) => {
        window.localStorage.setItem(storageKey, sessionId);
        window.sessionStorage.setItem(storageKey, sessionId);
      },
      [PRODUCT_ANON_SESSION_KEY, sharedSessionId],
    );
    await seedNotebookEntity(sharedSessionId, [
      "SoftBank enter-hand-off notebook",
      "First editable block",
      "Second editable block",
      "Third editable block",
    ]);

    const { blocks, reportRegion } = await openEntityLiveNotebook(page, NOTEBOOK_ENTITY_SLUG);
    const countBefore = await blocks.count();
    const markerA = ` [enter-a-${Date.now().toString(36)}]`;
    const markerB = ` [enter-b-${Date.now().toString(36)}]`;
    const { editorSurface } = await focusNotebookBlock(page, reportRegion, 1);

    await editorSurface.pressSequentially(markerA, { delay: 10 });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(350);
    await page.keyboard.type(markerB, { delay: 10 });

    await expect
      .poll(async () => await blocks.count(), {
        timeout: 20_000,
        message: "expected enter to create a new live notebook block",
      })
      .toBe(countBefore + 1);

    await expect
      .poll(
        async () => ((await blocks.nth(1).locator('[role="textbox"]').first().textContent()) ?? "").trim(),
        {
          timeout: 20_000,
          message: "expected the original block to keep only the pre-enter text",
        },
      )
      .toContain(markerA);

    await expect
      .poll(
        async () => ((await blocks.nth(2).locator('[role="textbox"]').first().textContent()) ?? "").trim(),
        {
          timeout: 20_000,
          message: "expected post-enter typing to land in the next block",
        },
      )
      .toContain(markerB.trim());
  });

  test("10 shared collaborators can edit mixed sections and the same section without losing persisted content", async ({
    browser,
  }) => {
    test.setTimeout(5 * 60 * 1000);

    const sharedSessionId = `pw-collab-${Date.now()}`;
    const contexts: BrowserContext[] = [];
    const pages: Page[] = [];

    const createCollaboratorPage = async () => {
      const context = await browser.newContext();
      contexts.push(context);
      await primeSharedProductSession(context, sharedSessionId);
      const page = await context.newPage();
      pages.push(page);
      return page;
    };

    try {
      const seedPage = await createCollaboratorPage();
      await seedNotebookEntity(sharedSessionId, [
        "SoftBank collaboration notebook",
        "Random section seed 1",
        "Random section seed 2",
        "Random section seed 3",
        "Random section seed 4",
        "Random section seed 5",
        "Shared section seed",
        "Wrap-up section seed",
      ]);
      const seedNotebook = await openEntityLiveNotebook(seedPage, NOTEBOOK_ENTITY_SLUG, 8);

      await expect.poll(async () => await seedNotebook.blocks.count(), {
        timeout: 20_000,
        message: "expected enough notebook blocks for the collaboration scenario",
      }).toBeGreaterThan(6);

      for (let i = 1; i < 10; i += 1) {
        const page = await createCollaboratorPage();
        await openEntityLiveNotebook(page, NOTEBOOK_ENTITY_SLUG, 8);
      }

      const collaboratorSpecs = pages.map((page, index) => {
        const reportRegion = page.getByRole("region", { name: "Reports" });
        const marker = ` [c${index}]`;
        if (index < 5) {
          return {
            page,
            reportRegion,
            blockIndex: index + 1,
            marker,
          };
        }
        return {
          page,
          reportRegion,
          blockIndex: 6,
          marker,
        };
      });

      await Promise.all(
        collaboratorSpecs.map(async ({ page, reportRegion, blockIndex, marker }, index) => {
          await appendToNotebookBlock(page, reportRegion, blockIndex, marker);
          await pageWait(page, 100 + index * 20);
          await appendToNotebookBlock(page, reportRegion, blockIndex, `${marker}-2`);
        }),
      );

      await pageWait(seedPage, 2_500);
      await seedPage.reload({ waitUntil: "domcontentloaded" });
      const finalNotebook = await openEntityLiveNotebook(seedPage, NOTEBOOK_ENTITY_SLUG, 8);
      const finalBlocks = finalNotebook.blocks;

      for (let index = 0; index < 5; index += 1) {
        const marker = ` [c${index}]`;
        await expect
          .poll(
            async () =>
              ((await finalBlocks.nth(index + 1).locator('[role="textbox"]').first().textContent()) ?? "").trim(),
            { timeout: 20_000, message: `expected random-section marker ${marker} to persist` },
          )
          .toContain(`${marker}-2`);
      }

      const sharedBlockTextLocator = finalBlocks.nth(6).locator('[role="textbox"]').first();
      await expect
        .poll(
          async () => {
            const value = ((await sharedBlockTextLocator.textContent()) ?? "").trim();
            for (let index = 5; index < 10; index += 1) {
              if (!value.includes(` [c${index}]-2`)) {
                return false;
              }
            }
            return true;
          },
          {
            timeout: 20_000,
            message: "expected same-section collaborative markers to persist",
          },
        )
        .toBe(true);
    } finally {
      await Promise.all(
        contexts.map(async (context) => {
          await context.close().catch(() => undefined);
        }),
      );
    }
  });

  test("offline notebook edits replay after reconnect and tab reopen", async ({ browser }) => {
    test.setTimeout(4 * 60 * 1000);

    const sharedSessionId = `pw-offline-${Date.now()}`;
    const context = await browser.newContext();
    await primeSharedProductSession(context, sharedSessionId);

    try {
      const page = await context.newPage();
      await resetProductState(page);
      await page.evaluate(
        ([storageKey, sessionId]) => {
          window.localStorage.setItem(storageKey, sessionId);
          window.sessionStorage.setItem(storageKey, sessionId);
        },
        [PRODUCT_ANON_SESSION_KEY, sharedSessionId],
      );

      await seedNotebookEntity(sharedSessionId, [
        "SoftBank offline replay notebook",
        "Offline replay section seed",
        "Body block seed for offline replay verification.",
        "Wrap-up seed",
      ]);

      const { reportRegion } = await openEntityLiveNotebook(page, NOTEBOOK_ENTITY_SLUG);
      const marker = ` [offline-replay-${Date.now().toString(36)}]`;
      const { editorSurface } = await focusNotebookBlock(page, reportRegion, 2);

      await context.setOffline(true);
      await pageWait(page, 150);
      await editorSurface.pressSequentially(marker, { delay: 10 });
      await pageWait(page, 150);
      await pageWait(page, 600);
      await expect(reportRegion.getByRole("status")).toContainText("Offline", { timeout: 15_000 });
      await expect(reportRegion.getByRole("status")).toContainText("queued", { timeout: 15_000 });

      await page.close();

      await context.setOffline(false);
      const reopenedPage = await context.newPage();
      const reopenedNotebook = await openEntityLiveNotebook(reopenedPage, NOTEBOOK_ENTITY_SLUG);
      const replayedBlock = reopenedNotebook.blocks.nth(2).locator('[role="textbox"]').first();

      await expect
        .poll(
          async () => ((await replayedBlock.textContent()) ?? "").trim(),
          {
            timeout: 25_000,
            message: "expected offline queued edits to replay after reconnect and tab reopen",
          },
        )
        .toContain(marker);
      await expect(reopenedNotebook.reportRegion.getByRole("status")).not.toContainText("Offline", {
        timeout: 15_000,
      });
    } finally {
      await context.close().catch(() => undefined);
    }
  });
});
