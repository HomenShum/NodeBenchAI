"use node";

// Deprecated: server-side crypto removed. Use client-side Web Crypto in `src/lib/e2eCrypto.ts`.
// This module intentionally avoids importing Node 'crypto' to prevent bundling issues.

// getSecret removed; E2E means keys are encrypted on the client only.

export function encryptToString(_plaintext: string): string {
  throw new Error("Server-side encryption has been removed. Use client-side Web Crypto (see src/lib/e2eCrypto.ts).");
}

export function decryptFromString(_token: string): string {
  throw new Error("Server-side decryption has been removed. Use client-side Web Crypto (see src/lib/e2eCrypto.ts).");
}
