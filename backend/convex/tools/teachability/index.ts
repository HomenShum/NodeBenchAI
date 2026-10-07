/**
 * Teachability Module - Long-term user memory (facts, preferences, skills)
 *
 * Enables agents to learn and recall:
 * - Facts: user name, company, role, tools, etc.
 * - Preferences: tone, format, brevity, style
 * - Skills: user-defined procedures triggered by phrases
 *
 * Architecture:
 * 1. Analyzer detects teachable moments from conversation
 * 2. Teachings stored with embeddings for semantic retrieval
 * 3. Context handler injects relevant memories before responses
 * 4. Category-based conflict resolution archives old entries
 *
 * File structure:
 * - teachingAnalyzer.ts: Node.js action for LLM-based analysis
 * - userMemoryQueries.ts: Convex runtime queries/mutations
 * - userMemoryTools.ts: Node.js actions (embeddings, vector search)
 * - learnUserSkill.ts: Explicit skill learning tool
 */

// Teaching analyzer (detects facts/preferences/skills from conversation)
export {
  runTeachingAnalysis,
  analyzeForTeaching,
} from "./teachingAnalyzer";

// Queries and mutations (Convex runtime)
export {
  getTeachingById,
  listTeachingsByUser,
  listSkillsWithTriggers,
  getTopPreferences,
  persistTeaching,
  recordTeachingUsage,
} from "./userMemoryQueries";

// Actions with embeddings/vector search (Node.js runtime)
export {
  storeTeaching,
  searchTeachings,
  matchUserSkillTrigger,
  analyzeAndStoreTeachings,
  searchTeachingsTool,
  getTopPreferencesTool,
} from "./userMemoryTools";

// Explicit skill learning tool
export { learnUserSkill } from "./learnUserSkill";
