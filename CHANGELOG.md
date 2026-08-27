# Changelog

All notable changes to Claude Code Canary are documented here. Semantic Versioning applies from v1.0.0 onward.

## [Unreleased]

### Added

- add relative `compare` regression thresholds for total/input/output tokens, reported cost and tool calls
- measure real headless permission prompts through an isolated MCP `--permission-prompt-tool` probe and capture auto-mode `PermissionDenied` events through an additive temporary hook without persisting raw tool inputs
- preserve ordered hook lifecycle traces and support ordered/exact hook assertions plus release-to-release hook-sequence stability checks
- automatically enable Claude Code hook-event streaming when hook assertions or hook-sequence comparisons require it

## [1.0.1] - 2026-08-27

### Fixed

- pass `--verbose` whenever Claude Code is invoked with `--output-format stream-json`, restoring compatibility with current headless Claude Code releases
- add a regression test that locks the required `stream-json` invocation arguments
- accept both ASCII-armored and binary detached OpenPGP release signatures, restoring verification for current Claude Code release manifests
- make generated record/replay scenarios usable headlessly by preserving a safe edit-capable `acceptEdits` permission mode and a 10-turn allowance
- detect asynchronous provider rate/quota failures before deciding whether hosted live E2E is eligible for a capacity fallback
- recognize explicit upstream model-availability failures as provider fallback conditions without treating arbitrary 404/model-typo failures as eligible
- remove patch-version literals from stable API/Action tests so future patch releases validate against current package metadata instead of a stale `1.0.0` expectation
- raise generated plugin scenarios to a 200,000-token live-E2E budget so current Claude Code system/tool context does not trip the normal 80,000-token smoke-test guardrail

### Changed

- label `total_cost_usd` metrics as **reported cost** so proxy and local-model users do not mistake upstream accounting metadata for actual billing
- add a real Claude Code E2E harness with scheduled `core` coverage and a broader manual `full` suite for release validation
