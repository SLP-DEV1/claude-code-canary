# Roadmap

Claude Code Canary aims to be the compatibility and regression layer for serious Claude Code setups.

## v0.1 — Deterministic harness

- [x] YAML scenario schema
- [x] disposable detached Git worktrees
- [x] headless Claude Code runner
- [x] setup and verification commands
- [x] changed-file assertions
- [x] filesystem/content assertions
- [x] token, tool-call, cost and duration metrics
- [x] compare two executables
- [x] binary-search ordered executables
- [x] JSON artifacts
- [x] doctor and config validation
- [x] CI across supported Node releases
- [x] reusable GitHub Action with workflow summary and artifact upload
- [x] README/status badge integration documentation

## v0.2 — Claude Code version intelligence

- [x] resolve exact, `stable` and `latest` releases from official distribution endpoints
- [x] isolated per-version/per-platform binary cache
- [x] verify SHA-256 checksum and published file size before accepting a binary
- [x] verify detached signed manifests where supported
- [x] explicitly mark older installs as checksum-only where signatures are unavailable
- [x] re-verify cached binaries before reuse
- [x] Windows, macOS, Linux and musl platform mapping
- [x] `claude-canary versions list|install|path`
- [x] `claude-canary compare --from <version> --to <version>`
- [x] discover actual published ranges for release bisection
- [x] lazily download only releases probed by binary search

See [`VERSION_MANAGER.md`](VERSION_MANAGER.md).

## v0.3 — Configuration experiments

- [x] `CLAUDE.md` / `CLAUDE.local.md` A/B tests
- [x] isolated project/local settings overlays
- [x] rules and hook-directory variants
- [x] local plugin directory / zip variants
- [x] strict MCP configuration variants
- [x] repeated interleaved trials and aggregate statistics
- [x] pass-rate, token, tool-call, cost and duration deltas
- [x] machine-readable aggregate artifact
- [x] fixture-aware changed-file assertions
- [x] auto-memory/user-config isolation where supported
- [x] symlink-safe variant validation

See [`CONFIG_EXPERIMENTS.md`](CONFIG_EXPERIMENTS.md).

## v0.4 — Record and replay

- [x] snapshot a clean repository before a real task
- [x] keep pending recorder state outside the working-tree diff
- [x] capture exact starting Git commit and Claude version/model metadata
- [x] capture project configuration presence without raw environment values
- [x] redact common secrets and machine-specific absolute paths
- [x] reject secret-bearing/non-portable setup and verification commands
- [x] derive allow + require changed-file assertions
- [x] derive files-exist / files-absent assertions
- [x] generate reviewable editable Canary YAML
- [x] replay from the exact recorded commit in an isolated worktree

See [`RECORD_REPLAY.md`](RECORD_REPLAY.md).

## v0.5 — Reproduction bundles

- [x] `claude-canary repro <result>`
- [x] exact recorded/base Git commit resolution
- [x] minimal fixture export from deterministic scenario scope
- [x] hard denylist for credential/dependency/cache/build paths
- [x] symlink refusal and text-only bounded export
- [x] secret and machine-path redaction
- [x] sanitized scenario/result artifacts without environment values/raw transcript
- [x] environment/version manifest
- [x] shell and PowerShell reproduction launchers
- [x] Markdown issue report generator
- [x] fixture export manifest
- [x] documented threat model and review workflow

See [`REPRO_BUNDLES.md`](REPRO_BUNDLES.md).

## v0.6 — Plugin compatibility and ecosystem

- [x] focused `plugin-matrix`
- [x] newest-N, explicit-version and published-range selectors
- [x] authenticated per-release executable reuse
- [x] same Git starting commit and deterministic scenario for every release
- [x] fresh temporary plugin copy per run
- [x] JSON + Markdown compatibility artifacts
- [x] first incompatible release marker
- [x] CI-friendly failure semantics
- [x] bounded release/run safety limits
- [x] `plugin-init` discovery generator
- [x] command/agent/skill/hook/MCP smoke generation
- [x] default + manifest custom-path discovery
- [x] inline hook/MCP discovery and frontmatter metadata extraction
- [x] symlink-safe generator isolation and marker-protected `--force`
- [x] full `plugin-suite`
- [x] release × scenario compatibility matrix
- [x] stale and incomplete generated-suite protection
- [x] GitHub Action modes for plugin matrices and suites

See [`PLUGIN_COMPATIBILITY.md`](PLUGIN_COMPATIBILITY.md), [`PLUGIN_SMOKE_GENERATOR.md`](PLUGIN_SMOKE_GENERATOR.md) and [`PLUGIN_SUITE.md`](PLUGIN_SUITE.md).

## v1.0 — Stable contracts and release hardening

- [x] stable scenario schema `version: 1`
- [x] stable core run result schema `schemaVersion: 1`
- [x] JSON Schema for core run results
- [x] supported public ESM/programmatic API
- [x] explicit future schema migration/versioning policy
- [x] documented security/trust model
- [x] reproducibility guarantees and nondeterminism guidance
- [x] fail-closed malformed/truncated protocol handling
- [x] fail-closed measurable cost limits
- [x] bounded subprocess and release-download behavior
- [x] validated release platform overrides
- [x] cross-platform Linux/Windows/macOS CI
- [x] CodeQL + Dependabot baseline
- [x] SHA-pinned third-party Actions in repository workflows/action runtime
- [x] Marketplace-ready root Action metadata, inputs, outputs and branding
- [x] v1 release/Marketplace checklist
- [x] launch-focused README and copy-ready Action examples

## Post-v1 candidates

These are useful follow-ups, not blockers for the stable v1 contract:

- JUnit reporter
- multi-plugin workspace compatibility suites
- multi-scenario experiment suites
- percentile/median/confidence reporting for noisy repeated runs
- resumable downloads and cache pruning
- offline release-catalog snapshots / cached-only bisect mode
- richer status/badge/report integrations
- optional redacted event subset in reproduction bundles
- Action build caching or a pre-bundled runtime once a reproducible generated-artifact release process is in place

## Non-goals

Canary is not intended to be another chat transcript viewer, generic LLM benchmark leaderboard, or permission-bypass wrapper. Its core job is to answer: **what changed, did it regress, and where did the regression start?**
