import app from "../_searchApp.bundle.mjs";

export const maxDuration = 10;

export default function handler(req, res) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const params = new URLSearchParams(url.searchParams);
  req.url = `/shared-context/events${params.toString() ? `?${params.toString()}` : ""}`;
  return app(req, res);
}
