// Streaming event types for FastAgentPanel
import { ThinkingStep, ToolCall, Source } from './message';

export type StreamEventKind = 
  | 'sse.hello'
  | 'sse.closed'
  | 'sse.error'
  | 'run.start'
  | 'run.complete'
  | 'run.error'
  | 'thinking'
  | 'tool.call'
  | 'tool.args.delta'
  | 'tool.result'
  | 'tool.error'
  | 'search.results'
  | 'rag.results'
  | 'token.delta'
  | 'agent.spawn'
  | 'agent.complete'
  | 'node.start'
  | 'node.end';

export interface StreamEvent {
  kind: StreamEventKind;
  message?: string;
  data?: any;
  cursor?: number;
  ts?: number;
}

export interface StreamCallbacks {
  onThinking?: (step: ThinkingStep) => void;
  onToolCall?: (call: ToolCall) => void;
  onSource?: (source: Source) => void;
  onToken?: (token: string) => void;
  onComplete?: (data?: any) => void;
  onError?: (error: Error) => void;
  onAgentSpawn?: (agent: { id: string; name: string }) => void;
}

export interface StreamHandle {
  close: () => void;
  isActive: () => boolean;
}

