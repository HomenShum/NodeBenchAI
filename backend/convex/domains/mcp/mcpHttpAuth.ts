function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function unauthorized(message = "Unauthorized"): Response {
  return json(401, { success: false, error: message });
}

export function badRequest(message = "Bad Request", details?: unknown): Response {
  return json(400, { success: false, error: message, details });
}

export function ok(body: unknown, status = 200): Response {
  return json(status, body);
}

export function notFound(message = "Not Found"): Response {
  return json(404, { success: false, error: message });
}

export function serverError(message = "Internal Server Error", details?: unknown): Response {
  return json(500, { success: false, error: message, details });
}

export function tooManyRequests(message = "Too Many Requests", details?: unknown): Response {
  return json(429, { success: false, error: message, details });
}

export function requireMcpSecret(request: Request): Response | null {
  const expected = process.env.MCP_SECRET;
  if (!expected) {
    return serverError("Server misconfigured: MCP_SECRET not set");
  }
  const supplied = request.headers.get("x-mcp-secret") ?? "";
  if (!supplied || supplied !== expected) {
    return unauthorized("Invalid x-mcp-secret");
  }
  return null;
}

export async function readJson(request: Request): Promise<any> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
