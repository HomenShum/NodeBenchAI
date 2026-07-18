# DESIGN.md — approved decisions ledger

Standing context every design-touching agent reads BEFORE generating, after
[PRODUCT.md](PRODUCT.md). Pattern: impeccable.style/designing ("approved
decisions get written into DESIGN.md") — extended with our rule that every
entry cites its ENFORCEMENT, because a decision without a guard is a wish.

| Decision | Enforced by |
|---|---|
| Terracotta ember on near-black paper; `#d97757` accent via `--rd-accent`; Manrope display + JetBrains Mono data | `src/design/designSystem.ts` manifest + `npm run lint:design` |
| One motion identity: `--rd-ease-settle` cubic-bezier(.22,1,.36,1), durations 240/480/840ms; enter once, drift subtly, rest | `agent-workspace.css` tokens; reduced-motion blocks per system |
| The ember motif carries the product truth: landing threads → thinking thread → run theater → answer ticks | evidence folders `docs/design/ui-contract/2026*` |
| `prefers-reduced-motion` flattens EVERY animated system to its static composition | CSS guards + emulated verification (animationName: none) |
| Icons are stroke SVG (`stroke="currentColor"`), never emoji | `ChatResponseShape.guard.test.ts` emoji-block assertion |
| The answer is chat-shaped: prose leads; Reasoning/Tool/Sources collapse into the message, closed by default | `docs/design/ONE_CHAT_INTERFACE.md`; ChatResponseShape + honesty guards |
| ONE `ChatAssistantMessage` renders every completed answer (flagship, replay, panel) — renderer drift is structurally impossible | guard asserts both renderers import it; Phase B adapter fit-gate |
| Honesty is a rendering rule: empty over faked (no badge without computed state, `telemetry not recorded`, `Source needed`), failures render as failures | `chatRuns.contract.test.ts` L3 schemas; `canonicalAnswer.ts` refusal reasons |
| Compact shapes never re-inflate memo furniture | `computeIsCompactResponse` + guard-pinned gates |
| Surface invariants (anchors, computed geometry, theme wiring, forced states) live in executable contracts, run per-PR + nightly | `ui-contract/surfaces/*.contract.json` + `ui-contract-runner.spec.ts` + `nightly-design-loop.yml` |
| Every UI change ships with matched before/after captures | `docs/design/ui-contract/YYYYMMDD-<slice>/` + manifest schema |
| Copy is calm + evidential; labels a non-technical reader parses in 2s | PRODUCT.md voice; `reexamine_design_reduction` rule |

## The loop (impeccable's, mapped to our machinery)

- **Start** — read PRODUCT.md + this file; for signature work, produce/pick a
  hi-fi reference *before* CSS (code toward an image, not a paragraph).
- **Iterate** — name the discipline: typeset / layout / colorize / animate;
  `bolder` to bring a safe design to life, `quieter` to calm a shouting one;
  `critique` = our screenshot nitpick pass.
- **Polish (pre-ship gauntlet)** — audit = contract runner + guards;
  clarify = copy pass tuned to PRODUCT.md users; harden = reduced-motion,
  a11y, mobile geometry, theme parity.
- **Maintain** — design debt is tracked like code debt: nightly captures,
  dated evidence folders, decisions land HERE when approved — before the
  debt solidifies.

## Amending this ledger

A new decision enters only with its enforcement named (guard, contract
clause, lint, or scheduled capture). Aspirations without teeth go in a PR
description, not here.
