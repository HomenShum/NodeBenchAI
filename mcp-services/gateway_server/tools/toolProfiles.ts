import type { McpTool } from "./researchTools.js";

export const TOOL_PROFILE_NAMES = [
  "public-research",
  "gmail-research",
  "documents",
  "memory",
  "financial",
  "knowledge",
  "builder",
  "internal-full",
  "full",
] as const;

export type ToolProfileName = (typeof TOOL_PROFILE_NAMES)[number];

type ToolProfileDefinition = {
  name: ToolProfileName;
  description: string;
  toolNames?: readonly string[];
  prefixes?: readonly string[];
  all?: boolean;
};

const publicResearchTools = [
  "nodebench.entities.resolve",
  "nodebench.search_public_sources",
  "nodebench.research_company",
  "nodebench.research_person",
  "nodebench.research_role",
  "nodebench.dossiers.get",
  "nodebench.context.pack",
  "nodebench.get_matching_context",
  "nodebench.compile_interview_packet",
  "nodebench.claims.submit_public",
  "nodebench.claims.verify",
  "nodebench.watch_entity",
  "nodebench.link_private_signal_to_public_entity",
] as const;

const documentTools = [
  "createDocument",
  "createDocumentWithContent",
  "getDocument",
  "updateDocument",
  "archiveDocument",
  "restoreDocument",
  "searchDocuments",
  "listDocuments",
  "exportDocumentToMarkdown",
  "duplicateDocument",
  "createFolder",
  "listFolders",
  "getFolderWithDocuments",
  "addDocumentToFolder",
  "removeDocumentFromFolder",
  "createSpreadsheet",
  "listSpreadsheets",
  "getSpreadsheetRange",
  "applySpreadsheetOperations",
  "listFiles",
] as const;

const memoryTools = [
  "writeAgentMemory",
  "readAgentMemory",
  "listAgentMemory",
  "deleteAgentMemory",
] as const;

const financialTools = [
  "equity_price_quote",
  "equity_price_historical",
  "equity_fundamental_overview",
  "crypto_price_quote",
  "crypto_price_historical",
  "economy_gdp",
  "economy_inflation",
  "news_company",
  "news_world",
] as const;

const knowledgeTools = [
  "searchEntityContexts",
  "getEntityContext",
  "getEntityContextByName",
  "listEntityContexts",
  "getEntityContextStats",
  "getKnowledgeGraph",
  "getKnowledgeGraphClaims",
  "getSourceRegistry",
] as const;

const searchTools = ["quickSearch", "fusionSearch"] as const;

export const TOOL_PROFILES: Record<ToolProfileName, ToolProfileDefinition> = {
  "public-research": {
    name: "public-research",
    description:
      "Public entity research memory: entity resolution, sourced research, dossiers, context packs, claims, and watches.",
    toolNames: publicResearchTools,
  },
  "gmail-research": {
    name: "gmail-research",
    description:
      "Smallest profile for inbox/job integrations. Private scoring remains in the calling app.",
    toolNames: [
      "nodebench.entities.resolve",
      "nodebench.search_public_sources",
      "nodebench.research_company",
      "nodebench.research_person",
      "nodebench.research_role",
      "nodebench.dossiers.get",
      "nodebench.context.pack",
      "nodebench.get_matching_context",
      "nodebench.compile_interview_packet",
    ],
  },
  documents: {
    name: "documents",
    description: "Document, folder, spreadsheet, and file operations.",
    toolNames: documentTools,
  },
  memory: {
    name: "memory",
    description: "Agent memory key-value operations.",
    toolNames: memoryTools,
  },
  financial: {
    name: "financial",
    description: "Market, crypto, macroeconomic, and news lookup tools.",
    toolNames: financialTools,
  },
  knowledge: {
    name: "knowledge",
    description: "Knowledge graph, entity context, source registry, and search tools.",
    toolNames: [...knowledgeTools, ...searchTools],
  },
  builder: {
    name: "builder",
    description:
      "Builder-facing profile combining public research, knowledge context, document tools, memory, planning, and search.",
    toolNames: [
      ...publicResearchTools,
      ...knowledgeTools,
      ...searchTools,
      ...documentTools,
      ...memoryTools,
      "createPlan",
      "updatePlanStep",
      "getPlan",
      "getMissionDashboard",
      "getMission",
      "getMissionByKey",
      "getTasksForMission",
      "getPendingSniffChecks",
      "createMission",
      "claimTask",
      "resolveSniffCheck",
    ],
  },
  "internal-full": {
    name: "internal-full",
    description: "Full internal NodeBench MCP tool surface.",
    all: true,
  },
  full: {
    name: "full",
    description: "Alias for internal-full.",
    all: true,
  },
};

export function isToolProfileName(value: string | undefined): value is ToolProfileName {
  return Boolean(value && Object.prototype.hasOwnProperty.call(TOOL_PROFILES, value));
}

export function normalizeToolProfileName(value: string | undefined): ToolProfileName | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  return isToolProfileName(normalized) ? normalized : undefined;
}

export function listToolProfiles() {
  return TOOL_PROFILE_NAMES.map((name) => ({
    name,
    description: TOOL_PROFILES[name].description,
  }));
}

export function filterToolsForProfile(
  tools: McpTool[],
  profileName: ToolProfileName
): McpTool[] {
  const profile = TOOL_PROFILES[profileName];
  if (profile.all) return tools;

  const names = new Set(profile.toolNames ?? []);
  const prefixes = profile.prefixes ?? [];
  return tools.filter((tool) => {
    if (names.has(tool.name)) return true;
    return prefixes.some((prefix) => tool.name.startsWith(prefix));
  });
}
