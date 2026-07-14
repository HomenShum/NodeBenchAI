import { createServer, type Server } from "node:http";

import { expect, test } from "@playwright/test";

import { installOriginScopedCDPHeaders } from "./helpers/vercelPreview";

const TEST_HEADER = "x-nodebench-origin-secret";
const DUMMY_SECRET = "dummy-secret-never-use-for-auth";

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected a TCP address for the local security fixture");
  }
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

test("CDP origin-scoped header does not follow redirects from origin A to origin B", async ({
  page,
}) => {
  const originAHeaders: Array<string | undefined> = [];
  const originBHeaders: Array<string | undefined> = [];
  let originB = "";

  const serverB = createServer((request, response) => {
    if (request.url !== "/landing") {
      response.writeHead(204);
      response.end();
      return;
    }
    const value = request.headers[TEST_HEADER];
    originBHeaders.push(typeof value === "string" ? value : undefined);
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(
      "<!doctype html><title>origin B</title><p>redirect landed</p>",
    );
  });
  const serverA = createServer((request, response) => {
    if (request.url !== "/redirect") {
      response.writeHead(204);
      response.end();
      return;
    }
    const value = request.headers[TEST_HEADER];
    originAHeaders.push(typeof value === "string" ? value : undefined);
    response.writeHead(302, { location: `${originB}/landing` });
    response.end();
  });

  let session:
    | Awaited<ReturnType<typeof installOriginScopedCDPHeaders>>
    | undefined;
  try {
    originB = await listen(serverB);
    const originA = await listen(serverA);
    session = await installOriginScopedCDPHeaders(page, originA, {
      [TEST_HEADER]: DUMMY_SECRET,
    });

    await page.goto(`${originA}/redirect`, { waitUntil: "load" });

    expect(originAHeaders, "origin A receives the scoped dummy header").toEqual(
      [DUMMY_SECRET],
    );
    expect(
      originBHeaders.length,
      "origin B receives the redirected request",
    ).toBe(1);
    expect(
      originBHeaders.every((value) => value === undefined),
      "origin B never receives the scoped dummy header",
    ).toBe(true);
  } finally {
    if (session) {
      await session.send("Fetch.disable");
      await session.detach();
    }
    await Promise.all([close(serverA), close(serverB)]);
  }
});
