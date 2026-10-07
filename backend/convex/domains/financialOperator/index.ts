/**
 * Financial Operator Console — domain index.
 *
 * Public surface:
 *   - Mutations + queries: `runOps`
 *   - Orchestrator action:  `orchestrator.runAttCostOfDebtDemo`
 *
 * The frontend imports them via `api.domains.financialOperator.<file>.<name>`.
 */

export * as runOps from "./runOps";
export * as orchestrator from "./orchestrator";
export * as orchestratorExamples from "./orchestratorExamples";
export * as realExtractors from "./realExtractors";
