/**
 * A citation with a broken line reference is worse than no citation, because a
 * reader follows it into the wrong function and believes what they see.
 *
 * Checking that the cited line NUMBER is inside the file proves the anchor is
 * stable. It does not prove the anchor is correct: a citation that has drifted
 * onto a different symbol is still in range, and a range-only check passes it.
 * So every citation here must also carry the text expected on that line, and
 * this script asserts the line MATCHES it.
 *
 *   .tours/*.tour       every step must carry `pattern`, and the cited line
 *                       must match that regex. A step with no `pattern` is
 *                       rejected rather than range-checked.
 *   docs/START_HERE.md  every `path:line` citation must be written
 *                       `path:line — expected text`, and that text must appear
 *                       literally on the cited line. Bare "line N" prose
 *                       references are rejected: nothing can check them, so
 *                       they rot silently.
 *
 * Run from the repo root: node scripts/validate-tours.mjs   (exit 0 = clean)
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

let checked = 0;
const problems = [];
const readLines = (file) => readFileSync(file, "utf8").split(/\r?\n/);

// ---------------------------------------------------------------- .tours/
for (const name of readdirSync(".tours").filter((f) => f.endsWith(".tour"))) {
  const tour = JSON.parse(readFileSync(join(".tours", name), "utf8"));
  tour.steps.forEach((step, i) => {
    const where = `${name} step ${i + 1} (${step.file}:${step.line})`;
    let source;
    try {
      source = readLines(step.file);
    } catch {
      problems.push(`${where} — file does not exist`);
      return;
    }
    if (!Number.isInteger(step.line) || step.line < 1 || step.line > source.length) {
      problems.push(`${where} — line out of range (file has ${source.length} lines)`);
      return;
    }
    if (!step.pattern) {
      problems.push(`${where} — no "pattern"; a line number alone proves the anchor is stable, not that it points at the right symbol`);
      return;
    }
    if (!new RegExp(step.pattern).test(source[step.line - 1])) {
      problems.push(`${where} — pattern /${step.pattern}/ does not match that line: ${source[step.line - 1].trim()}`);
      return;
    }
    if (!step.title || !step.description) {
      problems.push(`${where} — missing title or description`);
      return;
    }
    checked += 1;
  });
}

// ------------------------------------------------------- docs/START_HERE.md
const doc = "docs/START_HERE.md";
// A repo file path followed by :line. Requires a source extension immediately
// before the colon, so http://localhost:5173 and `temperature: 0.3` are not
// mistaken for citations.
const CITATION = /([\w./-]+\.(?:tsx?|mjs|cjs|js|json|md)):(\d+)/;

readLines(doc).forEach((text, i) => {
  const where = `${doc}:${i + 1}`;

  if (/\bline \d+\b/i.test(text)) {
    problems.push(`${where} — bare "line N" reference has nothing to check it against; cite it as \`path:line — text on that line\`, or drop the number and keep the symbol name`);
    return;
  }

  const cite = text.match(CITATION);
  if (!cite) return;

  const [matched, file, lineText] = cite;
  const line = Number(lineText);
  const anchor = text.slice(cite.index + matched.length).replace(/^\s*[—-]+\s*/, "").trim();

  if (!anchor) {
    problems.push(`${where} — citation ${file}:${line} carries no anchor; write \`${file}:${line} — <text on that line>\` so a drifted line number cannot pass`);
    return;
  }
  let source;
  try {
    source = readLines(file);
  } catch {
    problems.push(`${where} — ${file} does not exist`);
    return;
  }
  if (line < 1 || line > source.length) {
    problems.push(`${where} — ${file}:${line} out of range (file has ${source.length} lines)`);
    return;
  }
  if (!source[line - 1].includes(anchor)) {
    problems.push(`${where} — ${file}:${line} does not contain "${anchor}"; that line is: ${source[line - 1].trim()}`);
    return;
  }
  checked += 1;
});

if (problems.length) {
  console.error(problems.join("\n"));
  console.error(`\n${problems.length} broken citation(s).`);
  process.exit(1);
}
console.log(`All ${checked} citations resolve and match their anchors.`);
