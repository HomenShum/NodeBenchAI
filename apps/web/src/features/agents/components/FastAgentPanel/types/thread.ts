// Thread/Conversation types for FastAgentPanel
// Now using Agent component - threadId is a string, not Id<"chatThreads">
import { Id } from "../../../../../../convex/_generated/dataModel";

export interface Thread {
  _id: string; // Agent component uses string threadIds
  userId: Id<"users">;
  title: string;
  pinned?: boolean;
  createdAt: number;
  updatedAt: number;
  _creationTime: number;

  // Computed fields (from queries)
  messageCount?: number;
  lastMessage?: string;
  lastMessageAt?: number;
  toolsUsed?: string[];
  modelsUsed?: string[];
}

export interface ThreadCreateInput {
  title?: string;
  pinned?: boolean;
}

export interface ThreadUpdateInput {
  threadId: string; // Agent component uses string threadIds
  title?: string;
  pinned?: boolean;
}

