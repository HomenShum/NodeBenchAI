import type { SDKType, PersonaProfile } from "../types";
import { MODEL_CATALOG } from "../types";

export type HandoffStrategy =
  | "serialize_to_anthropic_thinking"
  | "supervisor_command"
  | "writer_merge"
  | "none";

export interface PersonaArchitecture {
  primarySdk: SDKType;
  reasoningModel: string;
  tools: string[];
  handoffStrategy: HandoffStrategy;
  personaProfile?: PersonaProfile;
}

function normalizePersona(input: string): string {
  return input.trim().toLowerCase();
}

export function determineArchitecture(query: string, persona: string): PersonaArchitecture {
  const p = normalizePersona(persona);

  const isBanker =
    p === "banker" ||
    p.includes("jpm_startup_banker") ||
    p.includes("banker");

  const isVc = p === "vc" || p.includes("early_stage_vc") || p.includes("vc");
  const isPartner = p.includes("ecosystem_partner") || p === "partner";

  const isCto = p === "cto" || p.includes("cto_tech_lead") || p.includes("cto");
  const isSalesEng = p.includes("sales_engineer") || p.includes("sales");

  const isFounder = p.includes("founder_strategy") || p === "founder";
  const isExecutive = p.includes("enterprise_exec") || p === "executive";

  const isAcademic = p.includes("academic_rd") || p === "academic";
  const isQuant = p.includes("quant_analyst") || p === "quant";
  const isProduct = p.includes("product_designer") || p === "product";

  if (isBanker || isVc || isPartner) {
    return {
      primarySdk: "convex",
      reasoningModel: MODEL_CATALOG.ANTHROPIC.OPUS,
      tools: ["openbb_finance", "linkup_search"],
      handoffStrategy: "serialize_to_anthropic_thinking",
      personaProfile: {
        role: isBanker ? "banker" : isVc ? "vc" : "partner",
        riskTolerance: isBanker ? "low" : "high",
        preferredFormat: "report",
      },
    };
  }

  if (isCto || isSalesEng) {
    return {
      primarySdk: "langgraph",
      reasoningModel: MODEL_CATALOG.OPENAI.FLAGSHIP,
      tools: ["github_api", "code_interpreter"],
      handoffStrategy: "supervisor_command",
      personaProfile: {
        role: isCto ? "cto" : "sales",
        riskTolerance: "low",
        preferredFormat: "code",
      },
    };
  }

  if (isExecutive || isFounder) {
    return {
      primarySdk: "vercel",
      reasoningModel: MODEL_CATALOG.GOOGLE.PRO,
      tools: ["summarizer", "context_compressor"],
      handoffStrategy: "writer_merge",
      personaProfile: {
        role: isExecutive ? "executive" : "founder",
        riskTolerance: "low",
        preferredFormat: "bullet",
      },
    };
  }

  if (isAcademic || isQuant || isProduct) {
    return {
      primarySdk: "anthropic",
      reasoningModel: MODEL_CATALOG.ANTHROPIC.SONNET,
      tools: ["linkup_search"],
      handoffStrategy: "none",
      personaProfile: {
        role: isAcademic ? "academic" : isQuant ? "quant" : "product",
        riskTolerance: "low",
        preferredFormat: "report",
      },
    };
  }

  return {
    primarySdk: "vercel",
    reasoningModel: MODEL_CATALOG.OPENAI.FAST,
    tools: ["web_search"],
    handoffStrategy: "none",
  };
}
