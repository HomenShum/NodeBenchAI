# AI Flywheel

This root reference is intentionally short because repo automation and MCP package tests resolve the flywheel contract from the workspace root. Deeper architecture notes can live under `docs/architecture` and `docs/methodology`, but this file is the durable operator checklist.

## Purpose

The flywheel prevents shallow implementation loops. Every meaningful change should be verified, dogfooded, and traced back to the request that caused it.

## Core Loop

1. Gather context and restate the target.
2. Implement the smallest viable change.
3. Run the verification floor.
4. Dogfood the changed surface.
5. Inspect failures and trace upstream to the cause.
6. Fix the cause, not the symptom.
7. Re-run verification and dogfood.
8. Completion traceability: cite the original request, link the changed artifacts, explain whether the implementation stayed aligned with the intended result, and record any residual risk before declaring the work done.

## Completion traceability

When the loop is complete, the final audit should cite the original request, link the changed artifacts, and explain whether the implementation stayed aligned with the intended result. Record residual risk explicitly so future sessions can see what was verified and what still needs attention.
