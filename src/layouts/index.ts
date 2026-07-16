/**
 * layouts/ — canonical cockpit shell exports.
 *
 * NodeBench now ships one active shell: the persistent cockpit. Legacy page-first
 * layout modules remain in the repo for compatibility and audits, but they are
 * intentionally not re-exported from this barrel.
 */

export { CockpitLayout } from "./CockpitLayout";
export { CommandBar } from "./CommandBar";
export { StatusStrip } from "./StatusStrip";
export { ActiveSurfaceHost } from "./ActiveSurfaceHost";
export { WorkspaceRail } from "./WorkspaceRail";
export { CommandPalette, AgentMetadata, HashtagQuickNotePopover } from "./chrome";
export { useCockpitMode } from "./useCockpitMode";

// Object-First Layout System (gradual rollout)
export { ObjectFirstLayout } from "./ObjectFirstLayout";
export { ObjectBar, type ObjectState, type Mode } from "./ObjectBar";
export { ObjectFirstSurfaceHost, ObjectFirstShell } from "./ObjectFirstSurfaceHost";
export { ObjectFirstToggle, ObjectFirstGlobalToggle } from "./ObjectFirstToggle";
