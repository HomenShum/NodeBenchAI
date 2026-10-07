/**
 * reasoningGraph.ts
 *
 * Type definitions for the Deep Agent 2.0 Parallel Reasoning Graph.
 * Supports the "Pruning Garden" architecture for Tree of Thoughts execution.
 */

// ============================================================================
// Node Types
// ============================================================================

export type NodeStatus =
  | "pending"      // Waiting to execute
  | "running"      // Currently executing
  | "verified"     // Passed verification
  | "failed"       // Execution error
  | "pruned"       // Killed by verification criteria
  | "completed"    // Successfully completed
  | "backtracked"; // Rolled back

export type NodeType =
  | "root"           // Initial user query
  | "decomposition"  // Breaking into subtasks
  | "sourcing"       // Wide-net data gathering
  | "candidate"      // A potential match (company, deal, etc.)
  | "verification"   // Kill chain check
  | "enrichment"     // Deep dive data
  | "critique"       // Cross-check between branches
  | "synthesis"      // Merge surviving paths
  | "output";        // Final formatted result

// ============================================================================
// Core Node Interface
// ============================================================================

export interface ReasoningNode {
  id: string;
  parentId: string | null;
  childrenIds: string[];
  type: NodeType;
  status: NodeStatus;

  // The Content
  label: string;                    // Short title for UI (e.g., "Check Competitor Pricing")
  content?: string;                 // The raw agent output

  // The Validation Layer
  confidenceScore?: number;         // 0-100
  critique?: string;                // Why this path was chosen or pruned
  pruneReason?: string;             // Specific reason for pruning

  // Parallel Execution Metadata
  branchIndex?: number;             // Position in parallel set
  siblingCount?: number;            // Total siblings

  // Persona-Specific Data Payload
  data?: CandidateData | EnrichmentData | Record<string, unknown>;

  // Timing
  startedAt: number;
  completedAt?: number;
  elapsedMs?: number;
}

// ============================================================================
// Candidate Data (for Deal Flow scenarios)
// ============================================================================

export interface CandidateData {
  // Core Identity
  companyName: string;
  sector: string;
  fundingAmount?: string;
  fundingStage?: string;
  fundingDate?: string;

  // Location & Structure
  hqLocation?: string;
  headcount?: number;
  parentCompany?: string;

  // Contact
  website?: string;
  email?: string;

  // Enrichment Summaries (filled by parallel agents)
  pedigree_summary?: string;        // Founders background
  moat_summary?: string;            // Patents, FDA, compliance
  network_summary?: string;         // VCs, board, connections

  // Source tracking
  sourceUrl?: string;
  discoveredAt?: number;
}

export interface EnrichmentData {
  category: "founder_pedigree" | "technical_moat" | "network_map" | "financial_fit" | "custom";
  headline: string;
  details: string[];
  signals: EnrichmentSignal[];
  confidence: number;
}

export interface EnrichmentSignal {
  label: string;
  value: string;
  sentiment: "positive" | "neutral" | "negative" | "unknown";
  source?: string;
}

// ============================================================================
// Session State (The Full Graph)
// ============================================================================

export interface AgentSessionState {
  sessionId: string;
  templateId: string;               // Which workflow template is active
  personaId: string;                // Current user persona

  status: "planning" | "sourcing" | "filtering" | "enriching" | "converging" | "completed" | "idle";
  phase: string;                    // Human-readable phase description
  phaseProgress: number;            // 0-100

  nodes: Record<string, ReasoningNode>;  // Flat map for O(1) lookups
  rootId: string;

  // Aggregated Stats
  stats: {
    totalCandidates: number;
    qualified: number;
    pruned: number;
    enriching: number;
  };

  // Timing
  startedAt: number;
  completedAt?: number;
}

// ============================================================================
// Workflow Template Types
// ============================================================================

export interface VerificationCriterion {
  id: string;
  label: string;
  prompt: string;
  required: boolean;               // If true, failure = immediate prune
  weight?: number;                 // For soft scoring (0-1)
}

export interface EnrichmentTask {
  id: string;
  label: string;
  prompt: string;
  icon?: string;
  color?: string;                  // Tailwind color class
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  personaId: string;

  // Trigger phrases that activate this template
  triggers: string[];

  // Phase 1: Sourcing (Parallel Wide Net)
  sourcing: {
    parallel_tasks: Array<{
      id: string;
      source: string;
      prompt: string;
    }>;
    max_candidates: number;
  };

  // Phase 2: Kill Chain (Fast Prune)
  verification_criteria: VerificationCriterion[];

  // Phase 3: Deep Enrichment (Parallel per Survivor)
  enrichment_tasks: EnrichmentTask[];

  // Phase 4: Output Format
  output_format: "shortlist_with_outreach_hooks" | "risk_matrix" | "deal_memo" | "comparison_table" | "custom";
  output_prompt?: string;
}

// ============================================================================
// Persona Definition
// ============================================================================

export interface Persona {
  id: string;
  name: string;
  title: string;
  organization: string;
  icon: string;
  color: string;

  // What they care about
  priorities: string[];

  // Their typical queries
  example_queries: string[];

  // Default workflow template
  default_template_id: string;
}
