import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

// Retained authored examples. Never derive this expectation from the built index.
const groups = [
  ["cards/DocumentCard", "DocumentsHub/Cards/DocumentCard", "TextDocument FileDocument TimelineDocument FavoriteDocument ArchivedDocument WithCoverImage HybridMode Dragging Selected WithAllActions OpenOnSingleClick Interactive"],
  ["pills/RefsPills", "DocumentsHub/Pills/RefsPills", "NoReferences EmptyReferences SingleDocumentRef SingleTaskRef SingleEventRef MultipleReferences ManyReferences OverflowReferences Interactive"],
  ["rows/DocumentRow", "DocumentsHub/Rows/DocumentRow", "TextDocument FileDocument FavoriteDocument ArchivedDocument WithIcon CompactDensity ComfortableDensity Interactive"],
  ["rows/HolidayRow", "DocumentsHub/Rows/HolidayRow", "NewYearsDay IndependenceDay Christmas WithDateMs WithTitle CompactDensity ComfortableDensity"],
  ["rows/TaskRow", "DocumentsHub/Rows/TaskRow", "TodoTask InProgressTask DoneTask BlockedTask FavoriteTask HighPriorityTask UrgentPriorityTask TaskWithReferences ConfirmedEvent TentativeEvent CancelledEvent AllDayEvent CompactDensity ComfortableDensity Interactive"],
].map(([file, title, names]) => ({
  file: `apps/web/src/features/documents/components/documentsHub/${file}.stories.tsx`,
  title,
  exports: names.split(" "),
}));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const indexPath = "storybook-static/index.json";
const receipt = { status: "failed", proof: "retained-storybook-51", renderedProof: false };

try {
  // Existing Linux CI: refuse a symlink leaf and bound every read on one descriptor.
  const descriptor = fs.openSync(indexPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  let bytes;
  try {
    const before = fs.fstatSync(descriptor);
    assert(before.isFile() && before.size <= 2 * 1024 * 1024, "Index must be a regular file <= 2 MiB");
    bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      assert(count > 0, "Index ended before its recorded size");
      offset += count;
    }
    const after = fs.fstatSync(descriptor);
    assert(after.isFile() && after.size === before.size && after.mtimeMs === before.mtimeMs && after.ctimeMs === before.ctimeMs, "Index changed during bounded read");
  } finally {
    fs.closeSync(descriptor);
  }
  receipt.indexSha256 = sha256(bytes);
  receipt.indexBytes = bytes.length;
  const index = JSON.parse(bytes);
  assert.equal(index.v, 5, "Unexpected Storybook index schema");
  assert(index.entries && typeof index.entries === "object" && !Array.isArray(index.entries));
  const pairs = Object.entries(index.entries);
  assert(pairs.length <= 1000, "Index entry limit exceeded");
  const rows = pairs.map(([key, entry]) => {
    assert.equal(entry.id, key, "Index key/id mismatch");
    assert(["story", "docs"].includes(entry.type), "Unknown index entry type");
    assert.equal(typeof entry.importPath, "string");
    const file = entry.importPath.replaceAll("\\", "/").replace(/^\.\//, "");
    assert(groups.some((group) => group.file === file), "Unexpected story source");
    assert.equal(typeof entry.title, "string");
    if (entry.type === "story") assert.equal(typeof entry.exportName, "string");
    return { id: entry.id, type: entry.type, file, title: entry.title, exportName: entry.exportName ?? null };
  });
  receipt.stories = rows.filter((row) => row.type === "story").sort((a, b) => a.id.localeCompare(b.id));
  receipt.docs = rows.filter((row) => row.type === "docs").sort((a, b) => a.id.localeCompare(b.id));
  const storyKey = (row) => JSON.stringify([row.file, row.title, row.exportName]);
  const expected = groups.flatMap((group) => group.exports.map((exportName) => storyKey({ ...group, exportName })));
  assert.equal(receipt.stories.length, 51, "Retained story count changed");
  assert.deepEqual(receipt.stories.map(storyKey).sort(), expected.sort(), "Retained story identity changed");
  assert.equal(receipt.docs.length, 5, "Autodocs must be counted separately");
  assert.deepEqual(receipt.docs.map((row) => JSON.stringify([row.file, row.title])).sort(), groups.map((group) => JSON.stringify([group.file, group.title])).sort());
  const [checkoutCommit, checkoutTree] = execFileSync("git", ["rev-parse", "HEAD", "HEAD^{tree}"], { encoding: "utf8", timeout: 5000, maxBuffer: 1024 }).trim().split(/\r?\n/);
  assert.match(checkoutCommit, /^[a-f0-9]{40}$/);
  assert.match(checkoutTree, /^[a-f0-9]{40}$/);
  receipt.workflowSha = process.env.GITHUB_SHA ?? null; // May identify a PR merge commit.
  receipt.checkoutCommit = checkoutCommit;
  receipt.checkoutTree = checkoutTree;
  receipt.nodeVersion = process.version;
  receipt.versions = Object.fromEntries(["storybook", "vite"].map((name) => [name, JSON.parse(fs.readFileSync(`node_modules/${name}/package.json`, "utf8")).version]));
  receipt.sourceHashes = Object.fromEntries([...groups.map((group) => group.file), ".storybook/main.ts", ".storybook/preview.ts", "vite.config.ts", ".github/workflows/ci.yml"].map((file) => [file, sha256(fs.readFileSync(file))]));
  receipt.status = "passed";
} catch (error) {
  receipt.error = String(error.message).slice(0, 2048);
  process.exitCode = 1;
}

fs.writeFileSync("storybook-proof.json", `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ status: receipt.status, stories: receipt.stories?.length ?? null, docs: receipt.docs?.length ?? null, error: receipt.error ?? null }));
