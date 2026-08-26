# Roadmap

Claude Code Canary aims to become the compatibility and regression layer for serious Claude Code setups.

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
- [ ] JUnit reporter
- [ ] Windows integration fixture
- [ ] macOS integration fixture

## v0.2 — Claude Code version manager

Goal: make this work without users manually maintaining old binaries.

- discover installed/current Claude Code version
- resolve release metadata from official sources
- cache versioned binaries safely
- verify checksums/signatures where available
- Windows, macOS and Linux support
- `cc-canary versions list`
- `cc-canary versions install <version>`
- `cc-canary compare --from <version> --to <version>`
- `cc-canary bisect --good <version> --bad <version>`

The version manager must not depend on the deprecated global npm installation path.

## v0.3 — Configuration experiments

- `CLAUDE.md` A/B tests
- isolated settings overlays
- hook configuration variants
- plugin directory variants
- MCP configuration variants
- repeated trials and aggregate statistics
- significance/noise warnings for nondeterministic outcomes

## v0.4 — Record and replay

- record a real headless/interactively-exported task into a scenario candidate
- capture starting Git commit and deterministic verification signals
- redact secrets and machine-specific paths
- convert selected file/tool outcomes into assertions
- replay from the same repository state

## v0.5 — Reproduction bundles

- `cc-canary repro <result>`
- minimal fixture repository export
- environment/version manifest
- redacted stream event subset
- one-command reproduction script
- Markdown issue report generator

## v0.6 — Plugin compatibility

- plugin discovery fixture generator
- hooks/skills/commands/MCP smoke tests
- multi-version compatibility matrix
- reusable GitHub Action
- README compatibility badge

## v1.0

- stable scenario schema
- stable JSON result schema
- reporter/plugin API
- backwards-compatible migrations
- documented threat model
- reproducibility guarantees and known sources of nondeterminism

## Non-goals

Canary is not intended to be another chat transcript viewer, generic LLM benchmark leaderboard, or permission-bypass wrapper. Its core job is to answer: **what changed, did it regress, and where did the regression start?**
