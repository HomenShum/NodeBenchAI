export function isVercelPreviewUrl(url) {
  try {
    return new URL(url).hostname.endsWith(".vercel.app");
  } catch {
    return false;
  }
}

export function buildVercelBypassHeaders(url, secret) {
  const normalizedSecret = typeof secret === "string" ? secret.trim() : "";
  if (!normalizedSecret || !isVercelPreviewUrl(url)) return {};

  return {
    "x-vercel-protection-bypass": normalizedSecret,
  };
}
