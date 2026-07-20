/**
 * State Registry Search Adapter
 *
 * Verifies corporate entity existence via state Secretary of State registries.
 * Uses web scraping via Linkup for states without public APIs.
 *
 * @module search/fusion/adapters/stateRegistryAdapter
 */

import type { SearchResult, SearchSourceAdapter, SearchAdapterOptions } from "../types";

// ═══════════════════════════════════════════════════════════════════════════
// STATE REGISTRY TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface StateRegistryRecord {
  state: string;
  stateFullName: string;
  entityName: string;
  fileNumber: string;
  formationDate?: string;
  entityType?: string;
  status: "Active" | "Inactive" | "Dissolved" | "Merged" | "Suspended" | "Unknown";
  registeredAgent?: string;
  registeredAgentAddress?: string;
  jurisdiction?: string;
  lastReportDate?: string;
  sourceUrl: string;
  verifiedAt: number;
}

export interface StateRegistrySearchResult {
  found: boolean;
  records: StateRegistryRecord[];
  searchedStates: string[];
  error?: string;
}

// State registry URLs and patterns
const STATE_REGISTRIES: Record<string, {
  name: string;
  searchUrl: string;
  entitySearchUrl?: string;
  hasApi: boolean;
}> = {
  DE: {
    name: "Delaware",
    searchUrl: "https://icis.corp.delaware.gov/ecorp/entitysearch/namesearch.aspx",
    hasApi: false,
  },
  CA: {
    name: "California",
    searchUrl: "https://bizfileonline.sos.ca.gov/search/business",
    hasApi: false,
  },
  NY: {
    name: "New York",
    searchUrl: "https://appext20.dos.ny.gov/corp_public/corpsearch.entity_search_entry",
    hasApi: false,
  },
  TX: {
    name: "Texas",
    searchUrl: "https://mycpa.cpa.state.tx.us/coa/",
    hasApi: false,
  },
  FL: {
    name: "Florida",
    searchUrl: "https://search.sunbiz.org/Inquiry/CorporationSearch/ByName",
    hasApi: false,
  },
  NV: {
    name: "Nevada",
    searchUrl: "https://esos.nv.gov/EntitySearch/OnlineEntitySearch",
    hasApi: false,
  },
  WY: {
    name: "Wyoming",
    searchUrl: "https://wyobiz.wyo.gov/Business/FilingSearch.aspx",
    hasApi: false,
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// ADAPTER IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════════════

export class StateRegistryAdapter implements SearchSourceAdapter {
  source = "state_registry" as const;

  isAvailable(): boolean {
    return true;
  }

  async search(query: string, options: SearchAdapterOptions): Promise<SearchResult[]> {
    console.log(`[StateRegistryAdapter] Searching for: ${query}`);

    // This adapter works differently - it needs to be called with specific state context
    // For general search, we'll return guidance on how to use it
    return [];
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ENTITY VERIFICATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Search for entity in a specific state registry
   * Note: This requires web scraping via external service (Linkup) in production
   */
  async searchEntityInState(
    entityName: string,
    stateCode: string,
    webFetchFn?: (url: string, prompt: string) => Promise<string>
  ): Promise<StateRegistryRecord[]> {
    console.log(`[StateRegistryAdapter] Searching ${entityName} in ${stateCode}`);

    const registry = STATE_REGISTRIES[stateCode.toUpperCase()];
    if (!registry) {
      console.log(`[StateRegistryAdapter] Unknown state: ${stateCode}`);
      return [];
    }

    // If we have a web fetch function, use it to scrape the registry
    if (webFetchFn) {
      return this.scrapeStateRegistry(entityName, stateCode, registry, webFetchFn);
    }

    // Without web fetch, return guidance on manual verification
    console.log(`[StateRegistryAdapter] Web fetch not available, returning search URL`);
    return [{
      state: stateCode,
      stateFullName: registry.name,
      entityName: entityName,
      fileNumber: "",
      status: "Unknown",
      sourceUrl: registry.searchUrl,
      verifiedAt: Date.now(),
    }];
  }

  /**
   * Search for entity across multiple states (common incorporation states)
   */
  async searchEntityMultiState(
    entityName: string,
    states: string[] = ["DE", "CA", "NY", "NV", "WY"],
    webFetchFn?: (url: string, prompt: string) => Promise<string>
  ): Promise<StateRegistrySearchResult> {
    console.log(`[StateRegistryAdapter] Searching ${entityName} across ${states.length} states`);

    const allRecords: StateRegistryRecord[] = [];
    const searchedStates: string[] = [];

    for (const state of states) {
      try {
        const records = await this.searchEntityInState(entityName, state, webFetchFn);
        allRecords.push(...records);
        searchedStates.push(state);
      } catch (error) {
        console.error(`[StateRegistryAdapter] Error searching ${state}:`, error);
      }
    }

    return {
      found: allRecords.some(r => r.status === "Active"),
      records: allRecords,
      searchedStates,
    };
  }

  /**
   * Verify entity exists and is in good standing
   */
  async verifyEntity(
    entityName: string,
    claimedState?: string,
    webFetchFn?: (url: string, prompt: string) => Promise<string>
  ): Promise<{
    verified: boolean;
    record: StateRegistryRecord | null;
    discrepancies: string[];
    redFlags: string[];
    explanation: string;
  }> {
    console.log(`[StateRegistryAdapter] Verifying entity: ${entityName}`);

    // If claimed state is provided, search there first
    const statesToSearch = claimedState
      ? [claimedState, ...["DE", "CA", "NY", "NV", "WY"].filter(s => s !== claimedState)]
      : ["DE", "CA", "NY", "NV", "WY"];

    const searchResult = await this.searchEntityMultiState(
      entityName,
      statesToSearch.slice(0, 5),
      webFetchFn
    );

    if (!searchResult.found) {
      return {
        verified: false,
        record: null,
        discrepancies: [`Entity "${entityName}" not found in any searched state registry`],
        redFlags: ["entity_not_found"],
        explanation: `Could not find "${entityName}" in state corporate registries. Searched: ${searchResult.searchedStates.join(", ")}`,
      };
    }

    // Find the best matching record (active, in claimed state if provided)
    const activeRecords = searchResult.records.filter(r => r.status === "Active");
    const bestRecord = claimedState
      ? activeRecords.find(r => r.state === claimedState) || activeRecords[0]
      : activeRecords[0];

    const discrepancies: string[] = [];
    const redFlags: string[] = [];

    // Check if found in different state than claimed
    if (claimedState && bestRecord && bestRecord.state !== claimedState) {
      discrepancies.push(
        `Entity found in ${bestRecord.stateFullName}, not claimed ${STATE_REGISTRIES[claimedState]?.name || claimedState}`
      );
    }

    // Check for inactive/dissolved status
    const inactiveRecords = searchResult.records.filter(
      r => r.status === "Inactive" || r.status === "Dissolved"
    );
    if (inactiveRecords.length > 0) {
      redFlags.push("previously_dissolved");
      discrepancies.push(
        `Entity has inactive/dissolved records in: ${inactiveRecords.map(r => r.stateFullName).join(", ")}`
      );
    }

    return {
      verified: true,
      record: bestRecord || null,
      discrepancies,
      redFlags,
      explanation: bestRecord
        ? `Entity verified in ${bestRecord.stateFullName} (${bestRecord.status})`
        : "Entity verification incomplete",
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WEB SCRAPING HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Scrape state registry using web fetch
   */
  private async scrapeStateRegistry(
    entityName: string,
    stateCode: string,
    registry: { name: string; searchUrl: string },
    webFetchFn: (url: string, prompt: string) => Promise<string>
  ): Promise<StateRegistryRecord[]> {
    const prompt = `
      Search for the business entity "${entityName}" in the ${registry.name} Secretary of State / Division of Corporations website.

      Extract the following information if found:
      1. Exact entity name as registered
      2. File/Entity number
      3. Formation/Incorporation date
      4. Entity type (Corporation, LLC, etc.)
      5. Status (Active, Inactive, Dissolved, etc.)
      6. Registered agent name and address

      If multiple entities match, return information for all matches.
      If no entity is found, indicate "NOT FOUND".

      Format the response as JSON:
      {
        "found": true/false,
        "entities": [
          {
            "entityName": "...",
            "fileNumber": "...",
            "formationDate": "...",
            "entityType": "...",
            "status": "...",
            "registeredAgent": "...",
            "registeredAgentAddress": "..."
          }
        ]
      }
    `;

    try {
      const response = await webFetchFn(registry.searchUrl, prompt);

      // Parse the response
      const parsed = this.parseScrapedResponse(response, stateCode, registry.name, registry.searchUrl);
      return parsed;
    } catch (error) {
      console.error(`[StateRegistryAdapter] Scraping failed for ${stateCode}:`, error);
      return [];
    }
  }

  /**
   * Parse scraped response into structured records
   */
  private parseScrapedResponse(
    response: string,
    stateCode: string,
    stateName: string,
    sourceUrl: string
  ): StateRegistryRecord[] {
    try {
      // Try to extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.log(`[StateRegistryAdapter] No JSON found in response`);
        return [];
      }

      const data = JSON.parse(jsonMatch[0]);

      if (!data.found || !data.entities || data.entities.length === 0) {
        return [];
      }

      return data.entities.map((entity: any) => ({
        state: stateCode,
        stateFullName: stateName,
        entityName: entity.entityName || "",
        fileNumber: entity.fileNumber || "",
        formationDate: entity.formationDate,
        entityType: entity.entityType,
        status: this.normalizeStatus(entity.status),
        registeredAgent: entity.registeredAgent,
        registeredAgentAddress: entity.registeredAgentAddress,
        sourceUrl,
        verifiedAt: Date.now(),
      }));
    } catch (error) {
      console.error(`[StateRegistryAdapter] Failed to parse response:`, error);
      return [];
    }
  }

  /**
   * Normalize status strings to standard values
   */
  private normalizeStatus(status: string): StateRegistryRecord["status"] {
    if (!status) return "Unknown";

    const lower = status.toLowerCase();

    if (lower.includes("active") || lower.includes("good standing")) {
      return "Active";
    }
    if (lower.includes("inactive") || lower.includes("not in good standing")) {
      return "Inactive";
    }
    if (lower.includes("dissolved") || lower.includes("cancelled") || lower.includes("revoked")) {
      return "Dissolved";
    }
    if (lower.includes("merged")) {
      return "Merged";
    }
    if (lower.includes("suspended")) {
      return "Suspended";
    }

    return "Unknown";
  }

  /**
   * Get registry URL for a state
   */
  getRegistryUrl(stateCode: string): string | null {
    return STATE_REGISTRIES[stateCode.toUpperCase()]?.searchUrl || null;
  }

  /**
   * Get list of supported states
   */
  getSupportedStates(): Array<{ code: string; name: string }> {
    return Object.entries(STATE_REGISTRIES).map(([code, info]) => ({
      code,
      name: info.name,
    }));
  }
}

export const stateRegistryAdapter = new StateRegistryAdapter();
