/**
 * Shared async route error wrapper.
 * Eliminates 12+ identical try/catch blocks across route files.
 */

import type { Request, Response, RequestHandler } from "express";

type AsyncHandler = (req: Request, res: Response) => Promise<void> | void;

export function wrapRoute(handler: AsyncHandler): RequestHandler {
  return (req, res, next) => {
    try {
      const result = handler(req, res);
      if (result && typeof result.catch === "function") {
        result.catch((err: unknown) => {
          if (!res.headersSent) {
            res.status(500).json({ error: String(err) });
          }
        });
      }
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({ error: String(err) });
      }
    }
  };
}
