import app from "./_searchApp.bundle.mjs";

export const maxDuration = 60;

export default function handler(req, res) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathSegments = req.query?.path;
  let internalPath = "/voice";
  if (Array.isArray(pathSegments)) {
    internalPath = `/voice/${pathSegments.join("/")}`;
  } else if (typeof pathSegments === "string" && pathSegments) {
    internalPath = `/voice/${pathSegments}`;
  }

  const params = new URLSearchParams(url.searchParams);
  params.delete("path");
  const qs = params.toString();
  req.url = internalPath + (qs ? `?${qs}` : "");
  return app(req, res);
}
