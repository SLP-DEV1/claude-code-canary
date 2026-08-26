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
- reusable `Claude Canary` GitHub Action
- GitHub Actions Step Summary with comparison output
- automatic JSON result-artifact upload from the Action
- README/status-badge integration documentation and copy-ready workflow example

### Changed

- renamed the public CLI from `cc-canary` to `claude-canary`

### Planned

- release-range discovery for version-number bisect
- `CLAUDE.md` / settings / plugin / MCP A/B experiments
- record-to-scenario workflow
- minimal redacted repro bundles
- plugin compatibility matrix
- Action caching and richer reporting integrations

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
