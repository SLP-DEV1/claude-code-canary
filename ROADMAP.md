# Claude Code Canary Roadmap

Claude Code Canary exists to answer one question reliably:

> **What broke, when did it break, and can I prove it without guessing?**

## Status

The roadmap from v1.3 through v2.0 is implemented in the v2 compatibility platform. The v2.0.0 release candidate unifies release watching, scenario suites, compatibility evidence, CI reporting, trust regression testing and programmatic compatibility queries behind one local-first toolchain.

| Milestone | Status | Shipped outcome |
| --- | --- | --- |
| **v1.3** | ✅ Complete | Release watch, scenario suites, deterministic sharding, selective execution, run budgets, safe result reuse, flakiness analysis and failure fingerprints. |
| **v1.4** | ✅ Complete | Static HTML, JUnit, SARIF, GitHub summaries, local trends and explicit baseline proposals. |
| **v1.5** | ✅ Complete | Compatibility manifests, `canary.lock`, open registries, evidence-derived badges and inspectable scenario packs. |
| **v1.6** | ✅ Complete | Permission-policy coverage, hook/monitor trust checks, isolated MCP fixtures, gateway matrices and signed/checksummed attestations. |
| **v2.0** | ✅ Complete | Versioned public schemas, compatibility query/explain APIs, compatibility graph, multi-registry aggregation and the expanded TypeScript API. |

The implementation remains local-first: core compatibility workflows do not require a Canary-hosted service, and portable evidence excludes prompts, transcripts, credentials and raw environment values by default.

## v2.0 release contract

The v2 major keeps the existing deterministic scenario model and old CLI workflows while adding a v2 command surface and public compatibility contracts.

Key guarantees:

- Node.js 20+ remains supported.
- Existing `run`, `compare`, `bisect`, `pr-check`, baseline, plugin, MCP, experiment, record/replay, agent-team and Doctor workflows remain available.
- New Action modes include first-class `suite` and `watch` orchestration.
- `v1` remains the floating Action channel for the v1.x line; v2 releases use `v2`.
- Release publication requires a successful `Live Claude E2E (full)` run on the exact immutable release commit.
- Public v2 compatibility schemas are explicitly versioned; breaking changes require a new schema/major contract rather than silent mutation.

## Post-v2 direction

The next work should deepen usability and ecosystem adoption rather than re-create the compatibility core.

### v2.1 — Developer experience

- interactive `suite init` and migration helpers;
- clearer `lock diff` / manifest diff explanations;
- richer `report` navigation for large suites;
- documented examples for monorepos and multi-plugin workspaces;
- faster diagnostics for invalid or stale evidence;
- end-to-end examples for `watch` in scheduled GitHub Actions.

### v2.2 — Ecosystem publishing

- first-class static registry publishing helpers for GitHub Pages/Releases;
- signed compatibility-manifest publishing workflow;
- reusable community scenario-pack discovery metadata;
- evidence-backed compatibility badge generation and publishing;
- import/export tooling between independent registries.

### v2.3 — Scale

- shard-result merge as a first-class CLI operation;
- more aggressive compatibility-safe local/CI caching;
- incremental suite planning for large monorepos;
- bounded DAG-style orchestration for mixed scenario/plugin/MCP suites;
- compact historical indexes for long-running release-watch repositories.

### Future major ideas

A later major may add optional hosted visualization or shared indexing, but hosted infrastructure must remain optional. Local files, reproducible evidence and deterministic queries remain the source of truth.

## Product principles

Every future roadmap item should preserve these constraints:

- **Real Claude Code behavior over synthetic benchmarks.** Canary is not an LLM leaderboard.
- **Deterministic evidence over subjective grading.** Prefer assertions, lifecycle events, schemas, diffs, metrics and exit categories.
- **Exact-version reproducibility.** A failure must be replayable against the exact Git commit and Claude Code release that produced it.
- **Local-first and CI-friendly.** Core functionality must not depend on a hosted Canary service.
- **Privacy by default.** Portable artifacts should exclude prompts, transcripts, credentials and raw environment values unless explicitly requested.
- **Fail closed around integrity.** Unknown release metadata, malformed contracts, unsafe fixture export and incompatible baselines must not silently pass.
- **No hidden side effects.** Discovery/reporting stays read-only; mutating fixtures remain confined to Canary-owned temporary state.

The historical release record is maintained in [CHANGELOG.md](CHANGELOG.md).
