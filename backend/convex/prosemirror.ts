/**
 * Re-export prosemirror functions from domains/documents/prosemirror.ts
 * This file exists for backward compatibility with client code that imports from "prosemirror:*"
 */
export {
  getSnapshot,
  submitSnapshot,
  latestVersion,
  getSteps,
  submitSteps,
  createDocumentWithInitialSnapshot,
  migrateDocumentContent,
  resetDocumentSnapshot,
  resetAllSnapshots,
  internalResetAllSnapshots,
} from "./domains/documents/prosemirror";

