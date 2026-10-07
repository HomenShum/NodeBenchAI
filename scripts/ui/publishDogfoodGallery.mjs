import path from "node:path";
import { existsSync } from "node:fs";
import { mkdir, readdir, copyFile, writeFile } from "node:fs/promises";

const DEFAULT_SRC_DIR = path.resolve(process.cwd(), "test-results", "full-ui-dogfood");
const SRC_DIR = process.env.DOGFOOD_SCREENSHOT_DIR
  ? path.resolve(process.cwd(), process.env.DOGFOOD_SCREENSHOT_DIR)
  : DEFAULT_SRC_DIR;
const OUT_DIR = path.resolve(process.cwd(), "public", "dogfood", "screenshots");
const MANIFEST_PATH = path.resolve(process.cwd(), "public", "dogfood", "manifest.json");

function titleCase(input) {
  return String(input)
    .split(/[\s-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Parse variant suffix from filename: -light, -mobile, -mobile-light */
function parseVariant(file) {
  const name = file.replace(/\.png$/i, "");
  if (name.endsWith("-mobile-light")) {
    return { baseName: name.replace(/-mobile-light$/, ""), theme: "light", viewport: "mobile" };
  }
  if (name.endsWith("-mobile")) {
    return { baseName: name.replace(/-mobile$/, ""), theme: "dark", viewport: "mobile" };
  }
  if (name.endsWith("-light")) {
    return { baseName: name.replace(/-light$/, ""), theme: "light", viewport: "desktop" };
  }
  return { baseName: name, theme: "dark", viewport: "desktop" };
}

function classify(baseName) {
  if (baseName.startsWith("settings-")) return { kind: "settings", label: titleCase(baseName.replace(/^settings-/, "")) };
  if (baseName.startsWith("interaction-")) return { kind: "interaction", label: titleCase(baseName.replace(/^interaction-/, "")) };
  if (baseName === "command-palette") return { kind: "interaction", label: "Command Palette" };
  if (baseName === "assistant-panel") return { kind: "interaction", label: "Assistant Panel" };
  return { kind: "route", label: titleCase(baseName) };
}

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
    await copyFile(path.join(SRC_DIR, file), path.join(OUT_DIR, file));
    const { baseName, theme, viewport } = parseVariant(file);
    const meta = classify(baseName);
    items.push({
      file,
      kind: meta.kind,
      label: meta.label,
      theme,
      viewport,
    });
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
    capturedAtIso: new Date().toISOString(),
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
