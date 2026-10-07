# Contributing to NodeBench AI

Thanks for your interest. NodeBench is open source (MIT). This guide tells you
where to start, what bar to meet, and how to ship.

## Start here — 30 minutes

1. **Read [`docs/START_HERE.md`](docs/START_HERE.md) first.** It covers the
   frontend-only start and follows one question through the current chat path.
   Use [`docs/ONBOARDING.md`](docs/ONBOARDING.md) for orientation; the broader
   [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) map needs its paths checked
   against the current tree.
2. **Agents read [`AGENTS.md`](AGENTS.md) and [`AGENT_COORDINATION.md`](AGENT_COORDINATION.md).**
   Check shared-file claims before editing. Read [`CLAUDE.md`](CLAUDE.md) for
   Claude Code conventions and the merge workflow.
3. **Read [`docs/runbooks/PROD_PARITY_UI_KIT_WORKFLOW.md`](docs/runbooks/PROD_PARITY_UI_KIT_WORKFLOW.md)
   before any UI/design-kit work.
4. **Skim [`.claude/rules/`](.claude/rules/)** — if you're using Claude Code
   on this repo, these are the enforced conventions (modular rules with
   `related_` frontmatter for two-hop discovery).
5. **Run** the app locally per the quickstart in `README.md`.

### First PR — the deterministic path

A new engineer's first PR should be small, scoped, and ship through CI
green on the first try. The two safest first-PR types:

- **Fix a stale doc claim.** Run a 4-axis canonical check (kit + production
  DOM + routing + git recency — see ARCHITECTURE.md) on something
  `docs/ARCHITECTURE.md` or `.claude/rules/*.md` says, and fix the doc if
  it's stale. Zero runtime risk.
- **Delete dead code.** Find a component, run the 4-axis check, if all
  four axes say it's orphan, delete + open PR.

Avoid as a first PR: anything touching the chat surface, any new Convex
table, any route rename. Those are 2-day investigations masquerading as
PRs.

## What we accept

| Contribution | Bar |
|---|---|
| Bug fix | Reproduce, root-cause (see `.claude/rules/analyst_diagnostic.md`), fix the cause not the symptom, add a scenario test |
| New diligence block | Follows `DiligenceBlock<T>` contract in [`docs/architecture/DILIGENCE_BLOCKS.md`](docs/architecture/DILIGENCE_BLOCKS.md) · authority allowlist · gates · fixtures · legal check |
| UI change | Visual verification (screenshot before/after) · `npx tsc --noEmit` clean · `npx vitest run` clean · respects `docs/architecture/DESIGN_SYSTEM.md` |
| New rule or skill | Follows the template of existing files in `.claude/rules/` (frontmatter, `related_`, prior art citation) |
| Architecture change | New ADR in `docs/architecture/plans/` with date prefix; supersedes existing via clear "Supersedes: [OLD.md]" header |

## What we don't accept (without discussion first)

- Silent auto-persistence of agent output (every new artifact needs an explicit promote flow)
- Unbounded in-memory caches (see `.claude/rules/agentic_reliability.md`)
- Fake confidence scores / hardcoded evidence floors
- New surface areas without a State / Target / Transition / Invariant spec
- New top-level directories without a 3-line README explaining purpose

## How to submit a change

### 1. Branch from latest `origin/main`

```bash
git fetch origin main
git checkout -b <type>/<short-slug> origin/main
```

Branch name format: `<type>/<short-slug>`. Types match Conventional Commits:

- `feat/` — new behavior or surface
- `fix/` — bug fix
- `cleanup/` — deletion / consolidation (sprint work)
- `docs/` — `.md` changes only
- `chore/` — tooling, deps, config
- `refactor/` — structural change, no behavior diff
- `test/` — test-only PRs
- `perf/`, `ci/`, `build/` — as named

### 2. Run locally before pushing

```bash
npx tsc --noEmit         # type-check (CI required check)
npx convex codegen       # Convex bundle analysis (CI required check — catches the @openai/agents class of bugs)
npm run test:run         # unit + runtime smoke (CI required check)
npm run build            # production build (CI required check)
```

If your change touches the UI:

```bash
npx vite preview --host 127.0.0.1 --port 4173 &
BASE_URL=http://127.0.0.1:4173 npx playwright test \
  evals/e2e/exact-kit-parity-prod.spec.ts \
  evals/e2e/one-flow-regression.spec.ts \
  --project=chromium
```

### 3. Conventional Commits subject

Format: `<type>(<scope>): <subject>` — e.g.
`fix(chat): reject missing deployment URLs before loading`.

### 4. PR size

**Hard limit: ~400 LOC of substantive change.** Split or pre-discuss
larger PRs.

**One concern per PR.** "Delete dead code + refactor + add a feature" =
three PRs, not one.

If you touched the UI: include before/after screenshots at 1440x900 and
375x812 (mobile) in the PR description.

### 5. Open the PR with auto-merge

```bash
gh pr create --title "..." --body "..."
gh pr merge <N> --auto --squash --delete-branch
```

**Use `--auto`, NOT `--admin`.** Branch protection enforces 4 required
checks: `Typecheck`, `Runtime smoke`, `Build`, `Tier B vs preview URL`.
`enforce_admins: true` — admins cannot bypass. Auto-merge fires when all
checks go green.

If you're tempted to use `--admin`, the answer is almost always "fix the
failing check first."

### 6. Dependency policy

Adding a production dependency requires the PR description to include:

- **Why this and not alternatives?** Why not extend an existing dep? Why
  not write the 50 lines yourself?
- **Install size impact** — `npm ls <pkg>` or `du -sh node_modules/<pkg>`.
- **License** — must be MIT-compatible permissive (MIT, BSD, ISC,
  Apache-2.0). No GPL/AGPL/SSPL.
- **Bundle-time analyzer compatibility** — verify `npx convex codegen`
  runs clean with the new dep before shipping. The `@openai/agents-core`
  zod regression that blocked deploys for hours is the canonical example
  this rule fights.

## Repository controls

The expected GitHub repository baseline is documented in
[`docs/runbooks/GITHUB_REPOSITORY_SETUP.md`](docs/runbooks/GITHUB_REPOSITORY_SETUP.md).

Maintainers should keep these controls enabled:

- `main` branch protection with required PR review
- Code Owner review
- required checks: `CI / Typecheck`, `CI / Runtime smoke`, `CI / Build`
- Dependabot alerts and security updates
- automatic branch deletion after merge

If repository settings drift, run:

```powershell
node scripts/github/configureRepoSettings.mjs --apply
```

## Code style

- **TypeScript strict mode** — no `any` in new code unless justified in comment
- **No ESLint disables** without a comment explaining why
- **Feature-first** — new browser code goes under `apps/web/src/features/<feature>/`, not in loose source folders
- **Tests colocated** — `*.test.ts` next to the file it tests (except e2e which lives in `evals/e2e/`)
- **Scenario tests, not shallow tests** — see `.claude/rules/scenario_testing.md`

## Commits

Conventional commit prefixes are encouraged:
- `feat(scope):` — new feature
- `fix(scope):` — bug fix
- `refactor(scope):` — refactor, no behavior change
- `docs(scope):` — docs only
- `test(scope):` — tests only

Commit body should answer "why", not just "what". The "what" is in the diff.

## Reporting security issues

Do **not** open a public issue for security vulnerabilities. Email the
maintainer (see [`package.json`](package.json) `author` field) or contact
privately via GitHub security advisories.

See [`docs/architecture/USER_FEEDBACK_SECURITY.md`](docs/architecture/USER_FEEDBACK_SECURITY.md)
for our threat model on user-submitted content.

## Where to ask

- Design questions → open a GitHub Discussion
- Bug reports → GitHub Issues with the `bug` label + reproduction steps
- Feature requests → GitHub Issues with the `enhancement` label + user story

## Attribution for prior art

Many patterns in this repo borrow from well-documented industry practice
(Anthropic's "Building Effective Agents", Manus AI's virtual workspace,
Cognition Devin, Claude Code's layered file-based memory, Cursor, Perplexity,
LangSmith, etc.). When adding a new pattern, cite its prior art in the
module header comment AND in the relevant `docs/architecture/` doc. See
`.claude/rules/reference_attribution.md` (if present) for the exact format.

## License

By contributing, you agree that your contributions will be licensed under the
same MIT license that covers the project. See [`LICENSE`](LICENSE).
