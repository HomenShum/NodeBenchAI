import type { CommandAction } from "./CommandPalette";
import { loadBuyerPreferredPath, type BuyerPreferredPath } from "@/features/controlPlane/lib/onboardingState";

const BUYER_ROUTE_PRIORITY: Record<BuyerPreferredPath, string[]> = {
  receipts: ["nav-inbox", "nav-home", "nav-chat", "nav-reports"],
  delegation: ["nav-home", "nav-inbox", "nav-chat", "nav-reports"],
  investigation: ["nav-home", "nav-chat", "nav-inbox", "nav-reports"],
  "mcp-ledger": ["nav-home", "nav-inbox", "nav-chat", "nav-reports"],
};

const DEFAULT_BUYER_ROUTE_PRIORITY = ["nav-home", "nav-reports", "nav-chat", "nav-inbox", "nav-me"];

export function getBuyerPreferredPriority(): string[] {
  const preferred = loadBuyerPreferredPath();
  return preferred ? BUYER_ROUTE_PRIORITY[preferred] : DEFAULT_BUYER_ROUTE_PRIORITY;
}

export function rankCommandPaletteCommands(commands: CommandAction[], query: string): CommandAction[] {
  if (query.trim()) return commands;

  const priority = getBuyerPreferredPriority();
  const rank = new Map(priority.map((id, index) => [id, index]));

  return [...commands].sort((a, b) => {
    const aRank = rank.get(a.id);
    const bRank = rank.get(b.id);
    if (aRank !== undefined && bRank !== undefined) return aRank - bRank;
    if (aRank !== undefined) return -1;
    if (bRank !== undefined) return 1;
    return 0;
  });
}
