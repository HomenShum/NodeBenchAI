/**
 * Send mock banker-grade digest to demonstrate full quality with enriched entities
 * Uses audit_mocks.ts style entities to show the complete ntfy experience
 */

import { action } from "../_generated/server";
import { api } from "../_generated/api";

export const sendMockBankerDigest = action({
  args: {},
  handler: async (ctx) => {
    console.log("[mockDigest] Building banker-grade digest with audit_mocks.ts quality entities...");

    const dateString = new Date().toISOString().slice(0, 10);

    // Mock enriched entities matching audit_mocks.ts quality
    const mockEnrichedEntities = [
      {
        name: "DISCO Pharmaceuticals",
        type: "company" as const,
        summary: "Cologne-based biotech advancing surfaceome-targeted oncology pipeline with €36M seed",
        funding: {
          stage: "Seed",
          totalRaised: { amount: 36, currency: "€", unit: "M" },
          lastRound: {
            roundType: "Seed",
            announcedDate: "2025-12-11"
          }
        },
        people: {
          founders: [
            { name: "Roman Thomas, M.D.", role: "Founder & Strategic Advisor" },
            { name: "Mark Manfredi, Ph.D.", role: "CEO" }
          ],
          headcount: "10-50"
        },
        productPipeline: {
          platform: "Proprietary surfaceome mapping for novel target discovery",
          modalities: ["Bispecific ADCs", "T-cell engagers"]
        },
        freshness: {
          newsAgeDays: 17,
          withinBankerWindow: true
        },
        personaReadiness: {
          ready: ["JPM_STARTUP_BANKER", "EARLY_STAGE_VC", "QUANT_ANALYST"],
          notReady: ["CTO_TECH_LEAD", "FOUNDER_STRATEGY"]
        }
      },
      {
        name: "Ambros Therapeutics",
        type: "company" as const,
        summary: "Irvine-based pain specialist launching with $125M Series A for CRPS-1 pivotal trial",
        funding: {
          stage: "Series A",
          totalRaised: { amount: 125, currency: "$", unit: "M" },
          lastRound: {
            roundType: "Series A",
            announcedDate: "2025-12-16"
          }
        },
        people: {
          founders: [
            { name: "Vivek Ramaswamy", role: "Co-Founder; Board member" },
            { name: "Keith Katkin", role: "Co-Founder; Chairman" }
          ],
          headcount: "10-50"
        },
        productPipeline: {
          platform: "Late-stage pain program with EU approval precedent",
          modalities: ["Bisphosphonate", "FDA Breakthrough"]
        },
        freshness: {
          newsAgeDays: 12,
          withinBankerWindow: true
        },
        personaReadiness: {
          ready: ["JPM_STARTUP_BANKER", "EARLY_STAGE_VC", "ACADEMIC_RD", "ENTERPRISE_EXEC"],
          notReady: ["CTO_TECH_LEAD"]
        }
      },
      {
        name: "Anthropic",
        type: "company" as const,
        summary: "AI safety leader releasing Claude 4.5 with enhanced reasoning and tool use capabilities",
        funding: {
          stage: "Series D",
          totalRaised: { amount: 7.3, currency: "$", unit: "B" },
          lastRound: {
            roundType: "Series D",
            announcedDate: "2024-03-28"
          }
        },
        people: {
          founders: [
            { name: "Dario Amodei", role: "Co-Founder; CEO" },
            { name: "Daniela Amodei", role: "Co-Founder; President" }
          ],
          headcount: "200-500"
        },
        productPipeline: {
          platform: "Constitutional AI for safe, steerable language models",
          modalities: ["Foundation models", "Enterprise API", "Claude Code"]
        },
        freshness: {
          newsAgeDays: 3,
          withinBankerWindow: true
        },
        personaReadiness: {
          ready: ["JPM_STARTUP_BANKER", "EARLY_STAGE_VC", "CTO_TECH_LEAD", "FOUNDER_STRATEGY"],
          notReady: []
        }
      }
    ];

    // Build compact message body
    const lines = [
      `**🧬 Morning Dossier** ${dateString}`,
      `Biotech & AI see major capital events: €36M surfaceome play, $125M pain thesis, Claude 4.5 release [Dashboard](https://nodebench-ai.vercel.app/)`,
      "",
      "**⚡ Market Pulse**",
      `Signal 94.2% ↑ | Biotech 42% ↑ | AI/ML 38% ↑ | Deals 3 fresh`,
      "",
      "**🔥 Top Signals**",
      "1. 🧬 **DISCO Pharma €36M Seed** - Surfaceome ADCs for SCLC/MSS-CRC",
      "   Cologne-based biotech advancing bispecific ADC platform with €36M financing",
      "   [Source](https://discopharma.de/)",
      "2. 💊 **Ambros $125M Series A** - CRPS-1 Phase 3 (Q1 2026 start)",
      "   Late-stage pain program with FDA Breakthrough designation",
      "   [Source](https://www.prnewswire.com/ambros-therapeutics)",
      "3. 🤖 **Anthropic Claude 4.5** - Enhanced reasoning & tool use",
      "   $7.3B-backed AI safety leader releases next-gen foundation model",
      "   [Source](https://www.anthropic.com/)",
      "",
      "**🏦 Entity Watchlist (Banker-Grade)**"
    ];

    // Add entity spotlight
    mockEnrichedEntities.forEach((entity) => {
      const funding = entity.funding?.stage
        ? `${entity.funding.stage} (${entity.funding.totalRaised?.currency}${entity.funding.totalRaised?.amount}${entity.funding.totalRaised?.unit})`
        : "";
      const freshTag = entity.freshness?.withinBankerWindow ? "✓ Fresh" : "";
      const personasReady = entity.personaReadiness?.ready?.length || 0;

      lines.push(`*   **${entity.name}**: ${funding} ${freshTag} | ${personasReady}/10 personas`);

      if (entity.people?.founders && entity.people.founders.length > 0) {
        const founder = entity.people.founders[0];
        lines.push(`    Founder: ${founder.name} (${founder.role})`);
      }
    });

    // Add strategic moves
    lines.push("");
    lines.push("**🎯 Strategic Moves**");
    lines.push("*   **For Bankers**: Update biotech M&A comps with DISCO/Ambros valuations; ADC sector thesis");
    lines.push("*   **For VCs**: Re-rank European biotech pipeline; validate surfaceome platform thesis");
    lines.push("*   **For Founders**: Study capital efficiency playbook (DISCO syndicate, Ambros licensing)");
    lines.push("*   **For CTOs**: Monitor Claude 4.5 tool use capabilities for agent workflows");
    lines.push("");
    lines.push("[Open Live Dossier](https://nodebench-ai.vercel.app/)");

    const body = lines.join("\n");

    // Truncate if needed
    const maxLen = 3700;
    const finalBody = body.length > maxLen
      ? `${body.slice(0, maxLen - 100)}...\n\n[Open Live Dossier](https://nodebench-ai.vercel.app/)`
      : body;

    console.log(`[mockDigest] Body length: ${finalBody.length} chars`);
    console.log(`[mockDigest] Enriched entities: ${mockEnrichedEntities.length}`);
    console.log(`[mockDigest] Total personas covered: ${new Set(mockEnrichedEntities.flatMap(e => e.personaReadiness?.ready || [])).size}/10`);

    // Send to ntfy
    await ctx.runAction(api.domains.integrations.ntfy.sendNotification, {
      title: `🧬 Morning Dossier - ${dateString} (BANKER-GRADE DEMO)`,
      body: finalBody,
      priority: 5, // Highest priority for demo
      tags: ["dna", "chart_with_upwards_trend", "moneybag", "bank"],
      click: "https://nodebench-ai.vercel.app/",
      eventType: "morning_digest_banker_demo",
    });

    console.log("[mockDigest] ✅ Banker-grade demo digest sent!");

    return {
      success: true,
      dateString,
      enrichedEntities: mockEnrichedEntities.length,
      personasCovered: new Set(mockEnrichedEntities.flatMap(e => e.personaReadiness?.ready || [])).size,
      bodyLength: finalBody.length,
      qualityScore: 100 // Matches audit_mocks.ts benchmarks
    };
  },
});
