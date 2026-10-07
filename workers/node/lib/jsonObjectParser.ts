export type JsonObjectParseResult<T = unknown> =
  | {
      ok: true;
      value: T;
      raw: string;
      repaired: boolean;
      repairNotes: string[];
    }
  | {
      ok: false;
      error: string;
      raw?: string;
      repairNotes: string[];
    };

function collectFencedBodies(text: string): string[] {
  const bodies: string[] = [];
  const fenceRegex = /```(?:json|JSON)?\s*([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = fenceRegex.exec(text)) !== null) {
    if (match[1]?.trim()) bodies.push(match[1]);
  }
  return bodies;
}

function findBalancedObjects(text: string): string[] {
  const candidates: string[] = [];

  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== "{") continue;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < text.length; index += 1) {
      const char = text[index];

      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === "\\") {
          escaped = true;
          continue;
        }
        if (char === "\"") {
          inString = false;
        }
        continue;
      }

      if (char === "\"") {
        inString = true;
        continue;
      }
      if (char === "{") {
        depth += 1;
        continue;
      }
      if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          candidates.push(text.slice(start, index + 1));
          start = index;
          break;
        }
      }
    }
  }

  return candidates;
}

export function extractJsonObjectCandidates(text: string): string[] {
  const seen = new Set<string>();
  const orderedSources = [...collectFencedBodies(text), text];
  const candidates: string[] = [];

  for (const source of orderedSources) {
    for (const candidate of findBalancedObjects(source)) {
      const trimmed = candidate.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      candidates.push(trimmed);
    }
  }

  return candidates;
}

function stripCommentsOutsideStrings(input: string): { json: string; changed: boolean } {
  let output = "";
  let changed = false;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      output += char;
      continue;
    }

    if (char === "/" && next === "/") {
      changed = true;
      index += 2;
      while (index < input.length && input[index] !== "\n" && input[index] !== "\r") {
        index += 1;
      }
      index -= 1;
      continue;
    }

    if (char === "/" && next === "*") {
      changed = true;
      index += 2;
      while (index < input.length && !(input[index] === "*" && input[index + 1] === "/")) {
        index += 1;
      }
      index += 1;
      continue;
    }

    output += char;
  }

  return { json: output, changed };
}

function escapeControlCharactersInsideStrings(input: string): { json: string; changed: boolean } {
  let output = "";
  let changed = false;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (inString) {
      if (escaped) {
        output += char;
        escaped = false;
        continue;
      }
      if (char === "\\") {
        output += char;
        escaped = true;
        continue;
      }
      if (char === "\"") {
        output += char;
        inString = false;
        continue;
      }
      if (char === "\r") {
        if (input[index + 1] === "\n") index += 1;
        output += "\\n";
        changed = true;
        continue;
      }
      if (char === "\n") {
        output += "\\n";
        changed = true;
        continue;
      }
      if (char === "\t") {
        output += "\\t";
        changed = true;
        continue;
      }

      const code = char.charCodeAt(0);
      if (code < 0x20) {
        output += `\\u${code.toString(16).padStart(4, "0")}`;
        changed = true;
        continue;
      }
    } else if (char === "\"") {
      inString = true;
    }

    output += char;
  }

  return { json: output, changed };
}

function removeTrailingCommasOutsideStrings(input: string): { json: string; changed: boolean } {
  let output = "";
  let changed = false;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      output += char;
      continue;
    }

    if (char === ",") {
      let nextIndex = index + 1;
      while (nextIndex < input.length && /\s/.test(input[nextIndex])) nextIndex += 1;
      if (input[nextIndex] === "}" || input[nextIndex] === "]") {
        changed = true;
        continue;
      }
    }

    output += char;
  }

  return { json: output, changed };
}

function findNextNonWhitespace(input: string, startIndex: number): string | undefined {
  let index = startIndex;
  while (index < input.length && /\s/.test(input[index])) index += 1;
  return input[index];
}

function insertLikelyMissingCommas(input: string): { json: string; changed: boolean } {
  let output = "";
  let changed = false;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
        const next = findNextNonWhitespace(input, index + 1);
        if (next === "\"" || next === "{" || next === "[") {
          output += ",";
          changed = true;
        }
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      output += char;
      continue;
    }

    output += char;
    if (char === "}" || char === "]") {
      const next = findNextNonWhitespace(input, index + 1);
      if (next === "{" || next === "[" || next === "\"") {
        output += ",";
        changed = true;
      }
    }
  }

  return { json: output, changed };
}

export function repairJsonishObject(raw: string): { json: string; notes: string[] } {
  const notes: string[] = [];
  let json = raw.trim().replace(/^\uFEFF/, "");

  const comments = stripCommentsOutsideStrings(json);
  if (comments.changed) notes.push("stripped comments");
  json = comments.json;

  const controls = escapeControlCharactersInsideStrings(json);
  if (controls.changed) notes.push("escaped control characters in strings");
  json = controls.json;

  const missingCommas = insertLikelyMissingCommas(json);
  if (missingCommas.changed) notes.push("inserted likely missing commas");
  json = missingCommas.json;

  const trailingCommas = removeTrailingCommasOutsideStrings(json);
  if (trailingCommas.changed) notes.push("removed trailing commas");
  json = trailingCommas.json;

  return { json, notes };
}

export function parseJsonObjectFromText<T = unknown>(text: string): JsonObjectParseResult<T> {
  const candidates = extractJsonObjectCandidates(text);
  const errors: string[] = [];

  for (const candidate of candidates) {
    try {
      return {
        ok: true,
        value: JSON.parse(candidate) as T,
        raw: candidate,
        repaired: false,
        repairNotes: [],
      };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }

    const repaired = repairJsonishObject(candidate);
    try {
      return {
        ok: true,
        value: JSON.parse(repaired.json) as T,
        raw: candidate,
        repaired: repaired.notes.length > 0,
        repairNotes: repaired.notes,
      };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  return {
    ok: false,
    error: errors[0] ?? "No balanced JSON object found",
    raw: candidates[0],
    repairNotes: [],
  };
}
