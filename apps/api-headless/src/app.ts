import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import { nanoid } from "nanoid";
import { ZodError } from "zod";

import { authMiddleware } from "./middleware/auth.js";
import { telemetryMiddleware, getMetrics } from "./middleware/telemetry.js";
import specsRouter from "./routes/specs.js";
import runsRouter from "./routes/runs.js";
import evidenceRouter from "./routes/evidence.js";
import replayRouter from "./routes/replay.js";
import searchRouter from "./routes/search.js";
import fetchRouter from "./routes/fetch.js";
import researchRouter from "./routes/research.js";
import resourcesRouter from "./routes/resources.js";
import reportsRouter from "./routes/reports.js";
import eventCapturesRouter from "./routes/eventCaptures.js";
import passportsRouter from "./routes/passports.js";
import receiptsRouter from "./routes/receipts.js";
import investigationsRouter from "./routes/investigations.js";
import intentLedgersRouter from "./routes/intent-ledgers.js";
import publicResearchRouter from "./routes/publicResearch.js";

export function createApp() {
  const app = express();

  const allowedOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(",").map((origin) => origin.trim())
    : ["http://localhost:3000", "http://localhost:5173", "http://127.0.0.1:5173"];

  app.use(helmet());
  app.use(
    cors({
      origin: process.env.NODE_ENV === "production" ? allowedOrigins : true,
      credentials: true,
      methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-API-Key", "X-Request-ID"],
    })
  );
  app.use(express.json({ limit: "100kb" }));

  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.requestId = (req.headers["x-request-id"] as string) || `req_${nanoid(16)}`;
    next();
  });

  app.use(telemetryMiddleware);
  app.use("/v1", authMiddleware);
  app.use("/v2", authMiddleware);

  app.use("/v1/specs", specsRouter);
  app.use("/v1/runs", runsRouter);
  app.use("/v1/evidence", evidenceRouter);
  app.use("/v1/replay", replayRouter);
  app.use("/v1/search", searchRouter);
  app.use("/v1/fetch", fetchRouter);
  app.use("/v1/research", researchRouter);
  app.use("/v1/public-research", publicResearchRouter);
  app.use("/v1/resources", resourcesRouter);
  app.use("/v1/reports", reportsRouter);
  app.use("/v1/event-captures", eventCapturesRouter);
  app.use("/v2/passports", passportsRouter);
  app.use("/v2/receipts", receiptsRouter);
  app.use("/v2/investigations", investigationsRouter);
  app.use("/v2/intent-ledgers", intentLedgersRouter);

  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      version: "0.1.0",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/metrics", (_req: Request, res: Response) => {
    res.json(getMetrics());
  });

  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      error: "not_found",
      message: "Route not found. See /health for API status.",
    });
  });

  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    console.error(`[error] ${req.method} ${req.path}`, err);

    if (err instanceof ZodError) {
      res.status(400).json({
        error: "validation_error",
        details: err.issues,
        requestId: req.requestId,
      });
      return;
    }

    if (err instanceof SyntaxError && "body" in err) {
      res.status(400).json({
        error: "invalid_json",
        message: "Request body contains invalid JSON",
        requestId: req.requestId,
      });
      return;
    }

    res.status(500).json({
      error: "internal_error",
      message: process.env.NODE_ENV === "production" ? "Internal server error" : err.message,
      requestId: req.requestId,
    });
  });

  return app;
}

export default createApp;
