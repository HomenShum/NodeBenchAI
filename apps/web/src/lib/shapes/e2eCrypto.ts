// Client-side E2E encryption utilities using Web Crypto (AES-GCM + PBKDF2)
// Format: v2:<salt_b64>:<iv_b64>:<cipher_b64>

const VERSION = "v2";

function toBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

function fromBytes(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function bytesToBase64(bytes: Uint8Array): string {
  // Use URL-safe base64 to avoid issues, but standard b64 is fine for storage
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    toBytes(password) as unknown as BufferSource,
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as unknown as BufferSource, iterations: 250000, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptToString(plaintext: string, passphrase: string): Promise<string> {
  if (!passphrase || !passphrase.trim()) throw new Error("Passphrase required for encryption");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const data = toBytes(plaintext);
  const cipherBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as unknown as BufferSource }, key, data as unknown as BufferSource);
  const cipher = new Uint8Array(cipherBuf);
  return [VERSION, bytesToBase64(salt), bytesToBase64(iv), bytesToBase64(cipher)].join(":");
}

export async function decryptFromString(token: string, passphrase: string): Promise<string> {
  const parts = token.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) throw new Error("Invalid encrypted token format");
  const [, saltB64, ivB64, cipherB64] = parts;
  const salt = base64ToBytes(saltB64);
  const iv = base64ToBytes(ivB64);
  const cipher = base64ToBytes(cipherB64);
  const key = await deriveKey(passphrase, salt);
  const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv as unknown as BufferSource }, key, cipher as unknown as BufferSource);
  return fromBytes(new Uint8Array(plainBuf));
}
