type ToonCodec = {
  encode: (input: unknown) => string;
  decode: (input: string) => unknown;
};

const fallbackCodec: ToonCodec = {
  encode: (input) => JSON.stringify(input, null, 2),
  decode: (input) => {
    try {
      return JSON.parse(input);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Optional @toon-format/toon package is not installed, and fallback decoding only accepts JSON-formatted payloads: ${detail}`,
      );
    }
  },
};

let codecPromise: Promise<ToonCodec> | null = null;

async function loadToonCodec(): Promise<ToonCodec> {
  if (!codecPromise) {
    codecPromise = (async () => {
      try {
        const specifier = "@toon-format/toon";
        const module = await import(specifier) as Partial<ToonCodec>;
        if (typeof module.encode === "function" && typeof module.decode === "function") {
          return { encode: module.encode, decode: module.decode };
        }
      } catch {
        // Local root installs do not always include package-scoped optional deps.
      }
      return fallbackCodec;
    })();
  }
  return codecPromise;
}

export async function encodeToon(input: unknown): Promise<string> {
  const codec = await loadToonCodec();
  return codec.encode(input);
}

export async function decodeToon(input: string): Promise<unknown> {
  const codec = await loadToonCodec();
  return codec.decode(input);
}
