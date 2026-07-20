# Changelog

### v0.3.6 (January 20, 2026)

**UI + Performance**
- Home: Added a "Start here" action row (Fast Agent, Create Dossier, What Changed) and clarified primary vs secondary CTAs.
- Fast Agent: Added a "Recent chats" landing section (avoids auto-opening the first thread) to improve conversion/retention.
- Bundling: Lazy-loaded `TabManager` + `FastAgentPanel` and deferred spreadsheet deps; reduced initial `vendor-*.js` bundle size and removed oversized chunk warnings.
- Changelog: Added in-app Changelog tab (Research Hub → Changelog).

**Models**
- Added OpenRouter priced models `glm-4.7-flash` and `glm-4.7` to the model registry and model picker.
- Benchmarks: Persona episode eval now estimates OpenRouter costs using the repo pricing catalog.

**Reliability**
- Website liveness: Multi-vantage consensus no longer marks sites "dead" from partial DNS/HTTP evidence, reducing false "website not live" signals.

**LinkedIn / Social**
- Added optional 2-stage semantic dedup scaffolding (`useSemanticDedup`) with embeddings + LLM-as-judge verdict fields for startup funding posts.

**Ops / Governance**
- Added schema support for SLO tracking, calibration proposals/deployments, and independent model validation workflow (SR 11-7 style separation of duties).

### v0.3.5 (January 16, 2026)

**Persona Evaluation System & Scientific Claim Verification**

Major expansion of the evaluation framework with persona-specific ground truth testing and enhanced scientific claim verification.

**Test Gap Fixes:**
| Gap | Fix |
|-----|-----|
| LK-99 False Negative | Debunked superconductor (2023) was rated LOW risk - Added scientific claim verification branch |
| Twitter/OpenAI False Positives | Legitimate companies flagged due to impersonation scam articles - Added context-aware scam detection |

**New Evaluation Framework:**
- **Unified Persona Harness** - Orchestrates evaluations across 11 personas in 5 groups
- **Ground Truth Cases** - Real, verifiable data (SEC EDGAR, FRED, ClinicalTrials.gov)
- **Scoring Framework** - 100-point normalized scoring with weighted categories and critical thresholds

