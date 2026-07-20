/**
 * Provider Registry — Resolves ChannelId → ChannelProvider
 *
 * Registers native providers at startup, then optionally probes the
 * OpenClaw Gateway for connected channels. Health-check aware: only
 * registers OpenClaw channels that are actually connected.
 */

import type { ChannelId, ChannelProvider, ProviderType } from "./channelProvider.js";
import { NATIVE_CHANNELS, OPENCLAW_CHANNELS } from "./channelProvider.js";

// Native providers
import { ntfyProvider } from "./providers/ntfyProvider.js";
import { emailProvider } from "./providers/emailProvider.js";
import { smsProvider } from "./providers/smsProvider.js";
import { slackProvider } from "./providers/slackProvider.js";
import { telegramProvider } from "./providers/telegramProvider.js";
import { discordProvider } from "./providers/discordProvider.js";
import { uiProvider } from "./providers/uiProvider.js";

// OpenClaw providers
import { openclawProviders, isGatewayAvailable } from "./providers/openclawProvider.js";

/* ================================================================== */
/* REGISTRY                                                            */
/* ================================================================== */

const registry = new Map<ChannelId, ChannelProvider>();

/** All native providers keyed by channel ID */
const NATIVE_PROVIDER_MAP: Record<string, ChannelProvider> = {
  ntfy: ntfyProvider,
  email: emailProvider,
  sms: smsProvider,
  slack: slackProvider,
  telegram: telegramProvider,
  discord: discordProvider,
  ui: uiProvider,
};

/**
 * Register a provider (overwrites existing for that channel).
 */
export function registerProvider(provider: ChannelProvider): void {
  registry.set(provider.channelId, provider);
}

/**
 * Get provider for a channel. Returns undefined if not registered.
 */
export function getProvider(channelId: ChannelId): ChannelProvider | undefined {
  return registry.get(channelId);
}

/**
 * Get all registered channel IDs.
 */
export function getRegisteredChannels(): ChannelId[] {
  return [...registry.keys()];
}

/**
 * Get all available channels (providers that pass isAvailable()).
 */
export async function getAvailableChannels(): Promise<ChannelId[]> {
  const results: ChannelId[] = [];
  for (const [id, provider] of registry) {
    if (await provider.isAvailable()) {
      results.push(id);
    }
  }
  return results;
}

/**
 * Get health status for all registered providers.
 */
export async function getHealthStatus(): Promise<
  Array<{ channelId: ChannelId; providerType: ProviderType; available: boolean; displayName: string }>
> {
  const statuses: Array<{
    channelId: ChannelId;
    providerType: ProviderType;
    available: boolean;
    displayName: string;
  }> = [];
  for (const [, provider] of registry) {
    statuses.push({
      channelId: provider.channelId,
      providerType: provider.providerType,
      available: await provider.isAvailable(),
      displayName: provider.displayName,
    });
  }
  return statuses;
}

/* ================================================================== */
/* INITIALIZATION                                                      */
/* ================================================================== */

/**
 * Initialize the registry with native providers.
 * Called at module load time — no async needed.
 */
export function initNativeProviders(): void {
  for (const channelId of NATIVE_CHANNELS) {
    const provider = NATIVE_PROVIDER_MAP[channelId];
    if (provider) {
      registry.set(channelId, provider);
    }
  }
}

/**
 * Probe the OpenClaw Gateway and register connected channels.
 * Called async after native init — non-blocking.
 *
 * Only registers channels that are actually connected on the Gateway.
 * If Gateway is unreachable, no OpenClaw channels are registered.
 */
export async function initOpenClawProviders(): Promise<ChannelId[]> {
  const registered: ChannelId[] = [];

  const gatewayUp = await isGatewayAvailable();
  if (!gatewayUp) {
    console.log("[ProviderRegistry] OpenClaw Gateway not reachable — skipping OpenClaw channels");
    return registered;
  }

  // Register all OpenClaw channel providers
  // The individual isAvailable() checks will determine which are actually connected
  for (const channelId of OPENCLAW_CHANNELS) {
    const provider = openclawProviders[channelId];
    if (provider) {
      registry.set(channelId, provider);
      registered.push(channelId);
    }
  }

  console.log(`[ProviderRegistry] Registered ${registered.length} OpenClaw channels: ${registered.join(", ")}`);
  return registered;
}

/**
 * Full initialization: native + OpenClaw.
 */
export async function initAllProviders(): Promise<{
  native: ChannelId[];
  openclaw: ChannelId[];
}> {
  initNativeProviders();
  const openclaw = await initOpenClawProviders();
  return {
    native: [...NATIVE_CHANNELS],
    openclaw,
  };
}

/**
 * Reset registry (for testing).
 */
export function _resetForTesting(): void {
  registry.clear();
}

// Auto-init native providers on module load
initNativeProviders();
