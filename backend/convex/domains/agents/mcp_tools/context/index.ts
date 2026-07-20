/**
 * Context Tools - 2025 Deep Agents Pattern
 * 
 * Based on:
 * - Anthropic "Effective harnesses for long-running agents" (Nov 2025)
 * - CLAUDE.md pattern from Claude Code Best Practices (Apr 2025)
 * 
 * These tools implement the Initializer Agent pattern to ensure agents
 * start each session with proper context, preventing the "wasted time"
 * failure mode.
 */

export {
  contextInitializerTool,
  type SessionContext,
} from "./contextInitializerTool";

