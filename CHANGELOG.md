# Changelog

All notable changes to Claude Code Canary will be documented here.

The project follows Semantic Versioning once the public CLI/schema reaches a stable release line. During the early `0.x` phase, scenario and result schemas may still evolve.

## [Unreleased]

### Added

- isolated Claude Code release cache backed by official versioned release endpoints
- SHA256 and published-size verification for downloaded and cached binaries
- detached manifest-signature verification for signed Claude Code releases
- `claude-canary versions install|list|path`
- `claude-canary compare --from <version> --to <version>` with automatic caching
- release-range bisection across actual published Claude Code versions
- reusable `Claude Canary` GitHub Action
- GitHub Actions Step Summary with comparison output
- automatic JSON result-artifact upload from the Action
- README/status-badge integration documentation and copy-ready workflow example
- configuration experiments for `CLAUDE.md`, settings, hooks, plugins and MCP
- record/replay workflow and privacy-first reproduction bundles
- `claude-canary plugin-matrix` for focused plugin compatibility checks across releases
- `claude-canary plugin-init` for automatic command/agent/skill/hook/MCP smoke-scenario generation
- generic Claude stdout/stderr presence/absence assertions for deterministic command-regression detection
- `claude-canary plugin-suite` for full generated release-by-scenario compatibility suites
- JSON and Markdown plugin-suite artifacts with per-release and per-scenario summaries
- stale/incomplete generated-suite protection and bounded suite run budgets

### Changed

- renamed the public CLI from `cc-canary` to `claude-canary`
- plugin matrix execution can suppress redundant summary artifacts when orchestrated by `plugin-suite`

### Planned

- multi-plugin workspace compatibility suites
- reusable GitHub Action mode for plugin suites and matrices
- Action caching and richer badge/reporting integrations
- multi-scenario configuration experiment suites and noise/confidence reporting

## [0.1.0] - 2026-08-26

### Added

- YAML scenario schema with JSON Schema companion
- disposable detached Git worktree runner
- headless Claude Code execution via `claude -p --output-format stream-json`
- setup and deterministic verification commands
- changed-file allow/deny assertions
- file existence and content assertions
- tool-call, token, cost, duration and hook-event metrics
- JSON result artifacts
- original `cc-canary init`
- original `cc-canary validate`
- original `cc-canary run`
- original `cc-canary compare`
- original `cc-canary bisect`
- original `cc-canary doctor`
- Node 20/22/24 CI matrix
- contribution, security and roadmap documentation
