export interface AgentActionContract {
  agentId: string;
  action: string;
  label: string;
  target?: string;
}

export function getAgentActionAttrs({ agentId, action, label, target }: AgentActionContract) {
  return {
    "data-agent-id": agentId,
    "data-agent-action": action,
    "data-agent-label": label,
    ...(target ? { "data-agent-target": target } : {}),
  } as const;
}
