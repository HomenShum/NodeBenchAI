import { describe, expect, it } from "vitest";

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
