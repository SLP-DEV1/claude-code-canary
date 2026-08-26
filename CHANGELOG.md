# Changelog

All notable changes to Claude Code Canary will be documented here.

The project follows Semantic Versioning once the public CLI/schema reaches a stable release line. During the early `0.x` phase, scenario and result schemas may still evolve.

## [Unreleased]

### Planned

- safe historical Claude Code version manager and cache
- `CLAUDE.md` / settings / plugin / MCP A/B experiments
- record-to-scenario workflow
- minimal redacted repro bundles
- plugin compatibility matrix and reusable GitHub Action

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
- `cc-canary init`
- `cc-canary validate`
- `cc-canary run`
- `cc-canary compare`
- `cc-canary bisect`
- `cc-canary doctor`
- Node 20/22/24 CI matrix
- contribution, security and roadmap documentation
