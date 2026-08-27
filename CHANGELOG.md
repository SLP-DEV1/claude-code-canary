# Changelog

All notable changes to Claude Code Canary are documented here. Semantic Versioning applies from v1.0.0 onward.

## [Unreleased]

### Fixed

- pass `--verbose` whenever Claude Code is invoked with `--output-format stream-json`, restoring compatibility with current headless Claude Code releases
- add a regression test that locks the required `stream-json` invocation arguments

### Changed

- label `total_cost_usd` metrics as **reported cost** so proxy and local-model users do not mistake upstream accounting metadata for actual billing

### Documentation

- document custom and local Claude Code gateways, including a successfully tested Claude Code Router → llama.cpp → Qwen3.8-27B setup
- clarify that reported cost values may be estimated, synthetic or otherwise unrelated to real billing when a proxy or local model is used

## [1.0.0] - 2026-08-27

### Added

- stable scenario schema `version: 1`
- stable core run result `schemaVersion: 1` plus `schemas/run-result.schema.json`
- stable ESM programmatic API via the package root export
- disposable detached Git worktree runner
- deterministic setup, verification, changed-file and filesystem/content assertions
- Claude output presence/absence assertions
- tool-call, token, cost, duration and hook-event metrics
- `claude-canary init`, `validate`, `run`, `doctor`
- isolated Claude Code release cache and `versions install|list|path`
- release comparison via `compare --from/--to`
- published-release binary search via `bisect --good/--bad`
- custom executable bisection
- configuration A/B experiments for instructions, settings, rules, hooks, MCP and plugins
- record/save/replay workflow from exact Git commits
- privacy-first bounded reproduction bundles
- plugin discovery and automatic smoke-scenario generation
- focused plugin release matrices
- full plugin release × scenario compatibility suites
- JSON and Markdown plugin compatibility reports
- stale/incomplete generated-suite protection and run-budget guardrails
- v1 GitHub Action modes: `compare`, `run`, `plugin-matrix`, `plugin-suite`
- GitHub Step Summary, structured Action outputs and result artifact upload
- SHA-pinned third-party Actions
- CodeQL and Linux/Windows/macOS CI coverage
- Dependabot configuration for npm and GitHub Actions
- Marketplace/release documentation and copy-ready workflows

### Security and reliability

- bounded Claude/Git subprocess capture to avoid unbounded-memory output collection
- fail-closed behavior for truncated or malformed `stream-json`
- fail-closed cost limits when Claude does not report a measurable cost value
- validation of Claude Code platform overrides before cache-path construction
- bounded release metadata/binary downloads
- checksum and published-size verification for release binaries
- detached manifest-signature verification where supported by the upstream release format
- cached binary integrity re-verification
- cleanup of temporary worktree directories after worktree-creation failures
- symlink refusal for plugin trees, generated plugin suites and configuration experiment variants
- marker-protected destructive regeneration and repro replacement
- exact direct npm dependency versions

### Changed

- public CLI name is `claude-canary`
- `plugin-init` points to `plugin-suite` as the broad compatibility workflow
- Action inputs are validated and converted to a direct argument array instead of shell interpolation
- README and documentation reorganized around v1 workflows, trust boundaries and release usage

### Compatibility

- Node.js 20+
- scenario schema: v1
- core run result schema: v1
- GitHub Action major compatibility channel: `v1` after the v1 release tag is published

## [0.1.0] - 2026-08-26

Initial deterministic harness release with scenario parsing, detached worktrees, headless Claude execution, assertions, metrics, JSON artifacts, executable comparison/bisection, doctor checks and Node 20/22/24 CI.
