/**
 * A tour with a broken line reference is worse than no tour, because a reader
 * follows it into the wrong function and believes what they see. This asserts
 * every step in .tours/ still resolves: the file exists, the line is inside it,
 * and the step's `pattern` still matches that exact line.
 *
 * Run: node scripts/validate-tours.mjs      (exit 0 = every step resolves)
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = ".tours";
let checked = 0;
const problems = [];

for (const name of readdirSync(dir).filter((f) => f.endsWith(".tour"))) {
  const tour = JSON.parse(readFileSync(join(dir, name), "utf8"));
  tour.steps.forEach((step, i) => {
    const where = `${name} step ${i + 1} (${step.file}:${step.line})`;
    let source;
    try {
      source = readFileSync(step.file, "utf8").split(/\r?\n/);
    } catch {
      problems.push(`${where} — file does not exist`);
      return;
    }
    if (!Number.isInteger(step.line) || step.line < 1 || step.line > source.length) {
      problems.push(`${where} — line out of range (file has ${source.length} lines)`);
      return;
    }
    if (step.pattern && !new RegExp(step.pattern).test(source[step.line - 1])) {
      problems.push(`${where} — pattern /${step.pattern}/ no longer matches: ${source[step.line - 1].trim()}`);
      return;
    }
    if (!step.title || !step.description) {
      problems.push(`${where} — missing title or description`);
      return;
    }
    checked += 1;
  });
}

if (problems.length) {
  console.error(problems.join("\n"));
  console.error(`\n${problems.length} broken tour step(s).`);
  process.exit(1);
}
console.log(`All ${checked} tour steps resolve.`);
