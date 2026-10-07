export type ActionItems = {
  valueProposition: string[];
  meetingTopics: string[];
  partnerships: string[];
  followUp: string[];
  risks: string[];
};

type ActionItemArgs = {
  companyName?: string;
  intent?: string;
  industry?: string;
  userProfile?: string;
};

/**
 * Lightweight heuristic generator for meeting prep and follow-up actions.
 * Keeps the structure stable for HTML/email renderers while allowing agent
 * outputs to be swapped in later.
 */
export function generateActionItems(params: ActionItemArgs): ActionItems {
  const company = params.companyName || "the company";
  const industry = params.industry || "their space";
  const userProfile = params.userProfile || "our agents and reasoning models";

  const isPartnership = params.intent === "partnership_inquiry" || params.intent === "demo_request";
  const isInvestment = params.intent === "investment_pitch";

  const valueProposition = [
    `Show how ${userProfile} reduce time-to-decision for ${industry}.`,
    `Map quick wins for ${company}: start with a 30-day pilot and one flagship workflow.`,
  ];

  if (isPartnership) {
    valueProposition.push(`Offer co-development on integration points (APIs, data feeds, dashboards).`);
  }
  if (isInvestment) {
    valueProposition.push(`Highlight traction stories and proof-points to de-risk diligence.`);
  }

  const meetingTopics = [
    "Current bottlenecks and where automation is blocked.",
    "Data flows and API surface area we can hook into.",
    "Definition of success for a 30-60 day pilot.",
  ];

  const partnerships = [
    "Technical integration: shared telemetry and observability.",
    "Pilot design: scope, success metrics, and owner on both sides.",
  ];

  const followUp = [
    "Send 2-3 relevant case studies before the call.",
    "Propose pilot milestones and owners in a shared doc.",
    "Include a calendar link with 2-3 time options this week.",
  ];

  const risks = [
    "Data access or compliance blockers.",
    "Latency or throughput expectations not yet validated.",
    "Unclear decision-maker/owner on their side.",
  ];

  return {
    valueProposition,
    meetingTopics,
    partnerships,
    followUp,
    risks,
  };
}
