# Changelog

All notable changes to Claude Code Canary are documented here. Semantic Versioning applies from v1.0.0 onward.

## [Unreleased]

## [1.2.0] - 2026-08-27

### Added

- Add `doctor --json` as a schema-versioned, secret-free extension compatibility preflight for provider mode, plugins, LSP binaries, project MCP transports and experimental agent-team constraints.
- Export the structured Doctor API/schema and fail closed on missing required LSP/stdio-MCP executables, malformed project MCP configuration and conflicting provider flags without starting extension processes.
- Add `team-run` for real interactive Claude Code agent-team observation with privacy-safe teammate/task/message lifecycle snapshots and deterministic expectations.
- Add `team-compare`, a public agent-team result schema/API, bounded observer logs, explicit non-TTY `unsupported` results, and exact-release execution through Canary's verified Claude Code cache.
- Plugin discovery and compatibility suites now understand Claude Code LSP servers, background monitors, and plugin dependency declarations. LSPs get generated release smoke scenarios; monitors and dependency constraints are tracked as static, side-effect-free compatibility surfaces.
- Extended plugin discovery is exported through the public TypeScript API.
- add protocol-native stdio MCP contract snapshots and checks for tools, JSON schemas, prompts, resources, resource templates and capabilities
- add `mcp-snapshot`, `mcp-check` and `mcp-compare` with paginated discovery, fingerprinted baselines, tool-safety annotation assertions and breaking/non-breaking contract reports

## [1.1.0] - 2026-08-27

### Added

- add relative `compare` regression thresholds for total/input/output tokens, reported cost and tool calls
- measure real headless permission prompts through an isolated MCP `--permission-prompt-tool` probe and capture auto-mode `PermissionDenied` events through an additive temporary hook without persisting raw tool inputs
- preserve ordered hook lifecycle traces and support ordered/exact hook assertions plus release-to-release hook-sequence stability checks
- automatically enable Claude Code hook-event streaming when hook assertions or hook-sequence comparisons require it
- add `pr-check` for same-Claude base-vs-head Git regression reports with Markdown/JSON output
- add committed, scenario-hash-protected metric baselines so recurring CI can compare with one Claude run
- add `pr-check` / `baseline-check` GitHub Action modes, shallow-checkout PR SHA hydration, and opt-in stable PR report comments

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
- prefer stable Gemini `gemini-3.6-flash` for hosted free live E2E, retain Groq for existing configurations, and use OpenRouter `openrouter/free` only for recognized primary-provider capacity/availability failures
- pin the headless Claude-to-provider adapter used by hosted live tests to an exact upstream commit that supports Gemini, OpenRouter and Groq routes
- add version-metadata consistency checks and a release-version helper so `package.json`, `package-lock.json` and the public CLI version stay synchronized
- keep Dependabot minor/patch updates grouped while deferring known v1-breaking dependency majors for explicit runtime/toolchain work
- require manual live E2E runs to have real provider authentication so a skipped manual run cannot be recorded as successful release evidence
- give live runs explicit `Live Claude E2E (core|full)` names and require a successful `full` run on the exact release commit before publication
- harden the npm release workflow for Trusted Publishing/OIDC, rerun-safe exact-version checks, npm registry verification, automatic GitHub Release creation, and movement of the compatible `v1` Action tag only after the whole release chain succeeds
- sharpen GitHub Marketplace metadata under the public `Claude Code Canary` name and expand npm discovery keywords without changing the v1 Action interface

### Documentation

- document custom and local Claude Code gateways, including a successfully tested Claude Code Router → llama.cpp → Qwen3.8-27B setup
- clarify that reported cost values may be estimated, synthetic or otherwise unrelated to real billing when a proxy or local model is used
- document local and GitHub Actions live E2E setup, authentication, cost and trust boundaries
- document the Gemini-first free-provider live E2E path and the distinction between provider-capacity/availability fallback and real Canary regression failures
- document the exact-commit `full` live E2E release gate, version preparation, npm bootstrap publication, automatic GitHub Release creation, and Trusted Publishing workflow
- add a distribution checklist for npm, GitHub Marketplace and curated Claude Code directories, and synchronize README discovery links and version display with v1.0.1

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
