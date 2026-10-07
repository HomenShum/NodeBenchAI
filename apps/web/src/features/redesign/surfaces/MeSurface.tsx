import { ExactMeSurface } from "../../designKit/exact/ExactKit";

/**
 * Me is the same owner-scoped runtime surface on desktop and mobile. The old
 * redesign-only document mock contained hard-coded identity, plan, usage, and
 * connector state plus a second render tree after an unconditional return.
 */
export function MeSurface() {
  return <ExactMeSurface />;
}
