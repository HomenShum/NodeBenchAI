/**
 * receiptFixtures.ts - Golden demo dataset for ActionReceiptFeed.
 *
 * Realistic agent receipts showing the trust infrastructure in action:
 * - Research agent gathering signals with verified sources
 * - OpenClaw-routed draft requiring approval
 * - Autonomous agent blocked by policy
 */

import type { ActionReceipt } from "../types/actionReceipt";
import type { AgentPassport } from "../types/agentPassport";

export const DEMO_PASSPORT: AgentPassport = {
  passportId: "pass_financial_analyst_02",
  userId: "user_demo",
  displayName: "Financial Analyst",
  trustTier: "supervised",
  allowedTools: ["web_search", "fetch_url", "create_document", "analyze_data"],
  deniedTools: ["execute_trade", "transfer_funds", "delete_data"],
  escalatedTools: ["send_email", "publish_report", "share_externally"],
  spendLimit: 0,
  dataScope: ["public_filings", "news_articles", "market_data"],
  createdAt: "2026-03-01T00:00:00Z",
  revokedAt: null,
};

export const DEMO_RECEIPTS: ActionReceipt[] = [
  {
    receiptId: "sha256:a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
    agentId: "research-scout-01",
    timestamp: "2026-03-10T09:15:23Z",
    action: {
      toolName: "web_search",
      params: { query: "SEC EDGAR FTX bankruptcy filings 2022", maxResults: 10 },
      summary: "Searched SEC EDGAR for FTX bankruptcy filings",
    },
    policyRef: {
      policyId: "pol_read_public",
      ruleName: "Allow public data reads",
      action: "allowed",
    },
    evidenceRefs: ["ev_sec_004"],
    result: {
      success: true,
      outputHash: "sha256:9f86d081884c7d659a2feaa0c55ad015",
      summary: "Retrieved 8 SEC filings related to FTX bankruptcy proceedings",
    },
    reversible: { canUndo: false },
    approval: { state: "not_required" },
    violations: [],
  },
  {
    receiptId: "sha256:b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5",
    agentId: "research-scout-01",
    timestamp: "2026-03-10T09:16:01Z",
    action: {
      toolName: "fetch_url",
      params: { url: "https://www.reuters.com/technology/ftx-withdrawals" },
      summary: "Fetched Reuters article on FTX withdrawal crisis",
    },
    policyRef: {
      policyId: "pol_read_public",
      ruleName: "Allow public data reads",
      action: "allowed",
    },
    evidenceRefs: ["ev_reuters_003"],
    result: {
      success: true,
      outputHash: "sha256:88d4264e0d3b54a21e7f3c9c0c7e3d5a",
      summary: "Captured article with content hash for provenance tracking",
    },
    reversible: { canUndo: false },
    approval: { state: "not_required" },
    violations: [],
  },
  {
    receiptId: "sha256:c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6",
    agentId: "financial-analyst-02",
    timestamp: "2026-03-10T09:18:44Z",
    action: {
      toolName: "create_document",
      params: { title: "FTX Investigation Brief", type: "dossier" },
      summary: "Created investigation dossier from gathered evidence",
    },
    policyRef: {
      policyId: "pol_write_workspace",
      ruleName: "Allow workspace writes",
      action: "allowed",
    },
    evidenceRefs: ["ev_sec_004", "ev_reuters_003", "ev_coindesk_001"],
    result: {
      success: true,
      outputHash: "sha256:4b2277e0d3b54a21e7f3c9c0c7e3d5a2",
      summary: "Dossier created with 3 evidence references linked",
    },
    reversible: { canUndo: true, undoInstructions: "Delete document doc_ftx_brief_001" },
    approval: { state: "not_required" },
    violations: [],
  },
  {
    receiptId: "sha256:d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1",
    agentId: "financial-analyst-02",
    timestamp: "2026-03-10T09:22:15Z",
    sessionKey: "agent:main:signal:user:+14155550123",
    channelId: "signal",
    direction: "draft",
    action: {
      toolName: "send_email",
      params: { to: "[REDACTED]", subject: "FTX Investigation Summary" },
      summary: "Drafted an external investigation summary for Signal delivery",
    },
    policyRef: {
      policyId: "pol_external_comms",
      ruleName: "Escalate external communications",
      action: "escalated",
    },
    evidenceRefs: ["ev_signal_thread_001"],
    result: {
      success: false,
      summary: "Action held for human approval before external communication is sent",
    },
    reversible: { canUndo: true, undoInstructions: "Cancel pending outbound draft in the gateway queue" },
    approval: {
      state: "pending",
      requestedAt: "2026-03-10T09:22:15Z",
    },
    openclaw: {
      sessionId: "sess_openclaw_demo_01",
      executionId: "exec_openclaw_demo_01",
      deployment: "openclaw-cloud",
    },
    violations: [
      {
        ruleId: "rule_ext_comm_001",
        ruleName: "External Communication Gate",
        severity: "warning",
        description: "Agent attempted to send an external message without prior human approval",
        resolution: "Review the draft and approve or deny it in the approval queue",
      },
    ],
  },
  {
    receiptId: "sha256:e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
    agentId: "autonomous-trader-03",
    timestamp: "2026-03-10T09:25:33Z",
    action: {
      toolName: "execute_trade",
      params: { symbol: "FTT", side: "sell", quantity: "[REDACTED]" },
      summary: "Attempted to execute FTT token sell order",
    },
    policyRef: {
      policyId: "pol_financial_ops",
      ruleName: "Block unauthorized financial operations",
      action: "denied",
    },
    evidenceRefs: [],
    result: {
      success: false,
      summary: "Action blocked because the agent passport does not include financial execution authority",
    },
    reversible: { canUndo: false },
    approval: { state: "denied", reviewedAt: "2026-03-10T09:25:33Z", reviewedBy: "policy-gateway" },
    violations: [
      {
        ruleId: "rule_spend_001",
        ruleName: "Spend Authority Required",
        severity: "block",
        description: "Agent attempted financial operation exceeding the configured spend limit",
        resolution: "Upgrade the passport to supervised tier with explicit spend authority",
      },
      {
        ruleId: "rule_scope_001",
        ruleName: "Data Scope Violation",
        severity: "block",
        description: "Agent accessed a financial execution API outside its declared data scope",
        resolution: "Add financial_execution to the passport data scope before retrying",
      },
    ],
  },
  {
    receiptId: "sha256:f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3",
    agentId: "research-scout-01",
    timestamp: "2026-03-10T09:28:10Z",
    action: {
      toolName: "save_session_note",
      params: { content: "FTX investigation complete - 4 observed facts, 2 hypotheses, 6 evidence items" },
      summary: "Saved session summary note",
    },
    policyRef: {
      policyId: "pol_write_workspace",
      ruleName: "Allow workspace writes",
      action: "allowed",
    },
    evidenceRefs: [],
    result: {
      success: true,
      outputHash: "sha256:a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d5",
      summary: "Session note persisted to local storage",
    },
    reversible: { canUndo: true, undoInstructions: "Delete note from ~/.nodebench/notes/" },
    approval: { state: "not_required" },
    violations: [],
  },
];
