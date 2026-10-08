import path from "node:path";
import { existsSync } from "node:fs";
import { mkdir, readdir, copyFile, readFile, rm, writeFile } from "node:fs/promises";

const DEFAULT_SRC_DIR = path.resolve(process.cwd(), "test-results", "full-ui-dogfood");
const SRC_DIR = process.env.DOGFOOD_SCREENSHOT_DIR
  ? path.resolve(process.cwd(), process.env.DOGFOOD_SCREENSHOT_DIR)
  : DEFAULT_SRC_DIR;
const OUT_DIR = path.resolve(process.cwd(), "public", "dogfood", "screenshots");
const MANIFEST_PATH = path.resolve(process.cwd(), "public", "dogfood", "manifest.json");

function isRetryableWriteError(error) {
  const code = String(error?.code ?? "").toUpperCase();
  return ["UNKNOWN", "EBUSY", "EPERM", "EACCES"].includes(code);
}

async function writeFileWithRetry(targetPath, contents, attempts = 6) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      await writeFile(targetPath, contents, "utf8");
      return;
    } catch (error) {
      lastError = error;
      if (!isRetryableWriteError(error) || attempt === attempts - 1) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  if (lastError) throw lastError;
}

async function main() {
  await rm(MANIFEST_PATH, { force: true });
  if (!existsSync(SRC_DIR)) {
    throw new Error(
      `Missing ${SRC_DIR}. Run the dogfood e2e first:\n` +
        `  npx playwright test evals/e2e/full-ui-dogfood.spec.ts --project=chromium --workers=1`,
    );
  }

  const files = (await readdir(SRC_DIR)).filter((f) => f.toLowerCase().endsWith(".png"));
  if (files.length === 0) {
    throw new Error(
      `No screenshots found in ${SRC_DIR}. Run the dogfood e2e first:\n` +
        `  npx playwright test evals/e2e/full-ui-dogfood.spec.ts --project=chromium --workers=1`,
    );
  }

  await mkdir(OUT_DIR, { recursive: true });

  const items = [];
  for (const file of files) {
    const metadataPath = path.join(SRC_DIR, `${file}.json`);
    if (!existsSync(metadataPath)) throw new Error(`Missing actual capture metadata: ${metadataPath}. Re-run the current dogfood e2e; filenames do not prove theme or state.`);
    const meta = JSON.parse(await readFile(metadataPath, "utf8"));
    if (meta.file !== file || meta.status !== "CAPTURED" || !["dark", "light"].includes(meta.theme) ||
        !["route", "interaction", "settings"].includes(meta.kind) || !["desktop", "mobile"].includes(meta.viewport) ||
        !meta.dimensions || !meta.observedUrl || !meta.observedState || !meta.label || !Number.isFinite(Date.parse(meta.capturedAtIso))) {
      throw new Error(`Invalid actual capture metadata: ${metadataPath}`);
    }
    await copyFile(path.join(SRC_DIR, file), path.join(OUT_DIR, file));
    await copyFile(metadataPath, path.join(OUT_DIR, `${file}.json`));
    items.push(meta);
  }

  items.sort((a, b) => {
    const order = { route: 0, interaction: 1, settings: 2 };
    const dk = (order[a.kind] ?? 9) - (order[b.kind] ?? 9);
    if (dk !== 0) return dk;
    const labelCmp = a.label.localeCompare(b.label);
    if (labelCmp !== 0) return labelCmp;
    // Within same label: dark-desktop first, then light-desktop, dark-mobile, light-mobile
    const variantOrder = { "dark:desktop": 0, "light:desktop": 1, "dark:mobile": 2, "light:mobile": 3 };
    return (variantOrder[`${a.theme}:${a.viewport}`] ?? 9) - (variantOrder[`${b.theme}:${b.viewport}`] ?? 9);
  });

  // Count variants
  const darkDesktop = items.filter((i) => i.theme === "dark" && i.viewport === "desktop").length;
  const lightDesktop = items.filter((i) => i.theme === "light" && i.viewport === "desktop").length;
  const darkMobile = items.filter((i) => i.theme === "dark" && i.viewport === "mobile").length;
  const lightMobile = items.filter((i) => i.theme === "light" && i.viewport === "mobile").length;

  const manifest = {
    // Publication cannot make old screenshots fresh again.
    capturedAtIso: new Date(Math.min(...items.map((item) => Date.parse(item.capturedAtIso)))).toISOString(),
    captureScope: "public-guest-read-only",
    basePath: "/dogfood/screenshots",
    variants: {
      darkDesktop,
      lightDesktop,
      darkMobile,
      lightMobile,
    },
    items,
  };

  await mkdir(path.dirname(MANIFEST_PATH), { recursive: true });
  await writeFileWithRetry(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");

  // eslint-disable-next-line no-console
  console.log(
    `Published ${items.length} screenshots to public/dogfood ` +
      `(${darkDesktop} dark-desktop, ${lightDesktop} light-desktop, ${darkMobile} dark-mobile, ${lightMobile} light-mobile) ` +
      `(manifest: public/dogfood/manifest.json)`,
  );
}

await main();
