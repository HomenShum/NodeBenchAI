import { stableStringify } from "./policy";

export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export async function digestCanonical(value: unknown): Promise<string> {
  return `sha256:${await sha256Hex(stableStringify(value))}`;
}
