import { AsyncLocalStorage } from "node:async_hooks";

export type GatewayRequestContext = {
  requestId?: string;
  jsonrpcId?: string | number | null;
  method?: string;
  toolName?: string;
  profileName?: string;
  authMode?: "token" | "anonymous" | "open";
  accountKey?: string;
  clientName?: string;
  clientVersion?: string;
  origin?: string;
  externalUserAgent?: string;
  tokenAuthEnabled?: boolean;
  tokenPresent?: boolean;
  remoteIp?: string;
  forwardedFor?: string;
  receivedAtIso?: string;
};

const storage = new AsyncLocalStorage<GatewayRequestContext>();

export function runWithRequestContext<T>(
  ctx: GatewayRequestContext,
  fn: () => Promise<T>
): Promise<T> {
  return storage.run(ctx, fn);
}

export function getRequestContext(): GatewayRequestContext | undefined {
  return storage.getStore();
}
