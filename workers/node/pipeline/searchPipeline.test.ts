import { afterEach, describe, expect, it, vi } from "vitest";

import { buildSearchQueries, classify, createInitialPipelineState, filterSearchSourcesForEntity } from "./searchPipeline.js";

describe("filterSearchSourcesForEntity", () => {
  it("keeps only clearly grounded sources for multi-word company names", () => {
    const filtered = filterSearchSourcesForEntity("Tests Assured", [
      {
        name: "Tests Assured – Cutting-edge AR/VR/MR Development and Testing Services",
        url: "https://testsassured.com/",
        snippet: "Tests Assured delivers quality assurance with proprietary AI-based QA software.",
      },
      {
        name: "Tests Assured | LinkedIn",
        url: "https://www.linkedin.com/company/tests-assured",
        snippet: "Tests Assured is the leading AR/VR solutions provider.",
      },
      {
        name: "RestAssured API Automation Testing Services Company - Testrig Technologies",
        url: "https://www.testrigtechnologies.com/restassured-testing-company/",
        snippet: "Enhance API reliability with RestAssured automation testing services.",
      },
      {
        name: "Getinge Assured Helix Tests - Getinge",
        url: "https://www.getinge.com/int/products/getinge-assured-helix-tests/",
        snippet: "Assured Helix Test is a reusable sterilization device.",
      },
    ], "company_search");

    expect(filtered.map((source) => source.name)).toEqual([
      "Tests Assured – Cutting-edge AR/VR/MR Development and Testing Services",
      "Tests Assured | LinkedIn",
    ]);
  });

  it("retains generic-title sources when the snippet explicitly grounds the entity", () => {
    const filtered = filterSearchSourcesForEntity("Anthropic", [
      {
        name: "Google pressures model pricing",
        url: "https://example.com/pricing-pressure",
        snippet: "Anthropic is under pricing pressure from Google in enterprise AI contracts.",
      },
      {
        name: "Ramp AI Index March 2026 update",
        url: "https://example.com/ramp-ai-index",
        snippet: "Broad enterprise AI adoption is accelerating across vendors.",
      },
    ], "company_search");

    expect(filtered.map((source) => source.name)).toEqual([
      "Google pressures model pricing",
    ]);
  });

  it("drops low-signal official legal pages and keeps external corroboration when available", () => {
    const filtered = filterSearchSourcesForEntity("Tests Assured", [
      {
        name: "Tests Assured - Cutting-edge AR/VR/MR Development and Testing Services",
        url: "https://testsassured.com/",
        snippet: "Tests Assured delivers world-class quality assurance for AR/VR and smart wearables.",
      },
      {
        name: "Privacy Policy - Tests Assured",
        url: "https://testsassured.com/privacy-policy/",
        snippet: "This privacy policy explains how Tests Assured uses personal data on its website.",
      },
      {
        name: "Tests Assured | LinkedIn",
        url: "https://www.linkedin.com/company/tests-assured",
        snippet: "Tests Assured is a leading AR/VR solutions provider focused on immersive technology testing.",
      },
      {
        name: "Tests Assured - Crunchbase Company Profile & Funding",
        url: "https://www.crunchbase.com/organization/tests-assured",
        snippet: "Tests Assured provides mobile, IoT, security, and immersive technology testing services.",
      },
    ], "company_search");

    expect(filtered.map((source) => source.name)).toEqual([
      "Tests Assured - Cutting-edge AR/VR/MR Development and Testing Services",
      "Tests Assured | LinkedIn",
      "Tests Assured - Crunchbase Company Profile & Funding",
    ]);
  });

  it("adds a profile-oriented query variant for company searches", () => {
    expect(buildSearchQueries("tests assured", "Tests Assured", "company_search")).toEqual([
      "tests assured",
      "\"Tests Assured\" company linkedin crunchbase glassdoor",
    ]);
  });

  it("fans out pasted recruiter packets into domain-aware search variants", () => {
    expect(
      buildSearchQueries(
        [
          "Cliffside Ventures hiring packet",
          "https://cliffside.ventures/",
          "https://www.linkedin.com/in/xudirk/",
        ].join(" "),
        "Dirk",
        "company_search",
      ),
    ).toEqual([
      "Cliffside Ventures hiring packet https://cliffside.ventures/ https://www.linkedin.com/in/xudirk/",
      "Cliffside Ventures hiring packet",
      "\"Dirk\" company linkedin crunchbase glassdoor",
      "\"Dirk\" site:cliffside.ventures",
      "\"Dirk\" site:linkedin.com",
      "\"Dirk\" founder profile linkedin",
      "\"Dirk\" hiring role expectations",
    ]);
  });

  it("anchors classification to the primary entity from context hints", () => {
    const state = classify(
      createInitialPipelineState(
        "What matters most about SoftBank right now?",
        "investor",
        "Primary entity for this run: SoftBank. Keep the brief anchored on this subject unless the user explicitly changes it.",
      ),
    );

    expect(state.entity).toBe("SoftBank");
  });

  it("skips question openers when extracting a fallback entity from the query", () => {
    const state = classify(
      createInitialPipelineState("What matters most about SoftBank right now?", "investor"),
    );

    expect(state.entity).toBe("SoftBank");
  });
});

describe("researcher recovery at provider and ticker-cache boundaries", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function configureFreeSources(serperValid: boolean) {
    vi.resetModules();
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "fixture-brave");
    vi.stubEnv("SERPER_API_KEY", "fixture-serper");
    vi.stubEnv("TAVILY_API_KEY", "");
    vi.stubEnv("LINKUP_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "fixture-gemini");
    vi.stubEnv("GOOGLE_API_KEY", "");
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (url.hostname === "api.search.brave.com") {
        return Response.json({ web: { results: [{ title: "Acme", url: {}, description: "Acme builds robotics." }] } });
      }
      if (url.hostname === "google.serper.dev") {
        return Response.json({ organic: [{ title: "Acme robotics", link: serperValid ? "https://acme.example/research" : {}, snippet: "Acme builds robotics." }] });
      }
      throw new Error(`Unexpected external fixture request: ${url.hostname}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("keeps usable Serper evidence when Brave returns a nonstring source URL", async () => {
    configureFreeSources(true);
    const { multiSearch } = await import("../lib/multiSearch.js");
    const result = await multiSearch("Acme robotics");
    expect(result.sources.map((source) => source.url)).toEqual(["https://acme.example/research"]);
    expect(result.providers).toEqual(["serper"]);
    expect(result.successfulProviderCount).toBe(1);
    expect(result.failures).toEqual([{ provider: "brave", code: "INVALID_PROVIDER_RESPONSE", upstreamStatus: undefined }]);
  });

  it("reports an upstream502 failure when every configured provider returns malformed source fields", async () => {
    const fetchMock = configureFreeSources(false);
    const { runSearchPipeline, getPipelineFailure, pipelineFailureHttpStatus } = await import("./searchPipeline.js");
    const state = await runSearchPipeline("Acme robotics", "founder");
    const failure = getPipelineFailure(state);
    expect(failure?.code).toBe("INVALID_PROVIDER_RESPONSE");
    expect(pipelineFailureHttpStatus(failure!.code)).toBe(502);
    expect(state.dcf).toBeNull();
    expect(state.trace.some((entry) => entry.tool === "package" || entry.tool === "analyze")).toBe(false);
    expect(fetchMock.mock.calls).toHaveLength(2);
  });

  it.each(["title", "content"])("keeps another paid variant and free evidence when a selected Linkup%s alias is malformed", async (alias) => {
    const fetchMock = configureFreeSources(true);
    const freeFixture = fetchMock.getMockImplementation()!;
    vi.stubEnv("LINKUP_API_KEY", "fixture-linkup");
    vi.stubEnv("NODEBENCH_ALLOW_PAID_SEARCH", "true");
    let paidCalls = 0;
    fetchMock.mockImplementation(async (input) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (url.hostname !== "api.linkup.so") return freeFixture(input);
      paidCalls++;
      const source = paidCalls === 1
        ? { url: "https://broken.example/acme", title: "Acme", content: "Acme builds robotics.", [alias]: {} }
        : { url: "https://primary.example/acme", name: "Acme robotics", snippet: "Acme builds robotics.", title: {}, content: {} };
      return Response.json({ answer: "Acme builds robotics.", sources: [source], results: [{ url: "https://secondary.example/acme", name: "Acme robotics", content: "Acme builds robotics." }] });
    });
    const { search, classify, createInitialPipelineState, getPipelineFailure } = await import("./searchPipeline.js");
    const state = await search(classify(createInitialPipelineState("Acme robotics", "founder")));
    expect(getPipelineFailure(state)).toBeNull();
    expect(state.searchSources.map((source) => source.url)).toContain("https://primary.example/acme");
    expect(state.searchSources.map((source) => source.url)).toContain("https://acme.example/research");
    expect(state.searchSources.map((source) => source.url)).not.toContain("https://broken.example/acme");
    expect(state.trace.some((entry) => entry.status === "degraded")).toBe(true);
    expect(paidCalls).toBe(3);
  });

  it("rejects25002 completed lookup keys without poisoning a later valid SEC lookup", async () => {
    vi.resetModules();
    const oversizedKeys = Object.fromEntries(Array.from({ length: 12_501 }, (_, i) => [String(i), { cik_str: i + 1, ticker: `T${i}`, title: `Company ${i}` }]));
    expect(new TextEncoder().encode(JSON.stringify(oversizedKeys)).byteLength).toBeLessThan(2_097_152);
    let tickerCalls = 0;
    let factsCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (url.href === "https://www.sec.gov/files/company_tickers.json") {
        tickerCalls++;
        return Response.json(tickerCalls === 1 ? oversizedKeys : { "0": { cik_str: 6, ticker: "ACM", title: "Acme" } });
      }
      if (url.href === "https://data.sec.gov/api/xbrl/companyfacts/CIK0000000006.json") {
        factsCalls++;
        return Response.json({ facts: {} });
      }
      throw new Error(`Unexpected external fixture request: ${url.hostname}`);
    }));
    const { fetchEdgarFinancials } = await import("../lib/secEdgar.js");
    expect(await fetchEdgarFinancials("Acme")).toBeNull();
    expect(factsCalls).toBe(0);
    expect(await fetchEdgarFinancials("Acme")).toMatchObject({ cik: "0000000006", ticker: "ACM", entityName: "Acme" });
    expect(tickerCalls).toBe(2);
    expect(factsCalls).toBe(1);
  });
});
