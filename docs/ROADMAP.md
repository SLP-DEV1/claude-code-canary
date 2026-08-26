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
- [x] reusable GitHub Action with workflow summary and artifact upload
- [x] README/status badge integration documentation
- [ ] JUnit reporter
- [ ] Windows integration fixture
- [ ] macOS integration fixture

## v0.2 — Claude Code version intelligence

Goal: make comparisons and regression bisection work without users manually maintaining old binaries or replacing their system Claude installation.

- [x] resolve exact, `stable` and `latest` releases from official distribution endpoints
- [x] isolated per-version/per-platform binary cache
- [x] verify SHA256 checksum and published file size before accepting a binary
- [x] verify detached manifests for 2.1.89+ with pinned Anthropic release-signing fingerprint
- [x] explicitly mark pre-2.1.89 installs as checksum-only
- [x] re-verify cached binary before reuse
- [x] Windows, macOS, Linux and musl platform mapping
- [x] `claude-canary versions list`
- [x] `claude-canary versions install <version>`
- [x] `claude-canary versions path <version>`
- [x] `claude-canary compare --from <version> --to <version>`
- [x] discover actual published release ranges for `claude-canary bisect --good <version> --bad <version>`
- [x] lazily download only releases probed by binary search
- [ ] resumable downloads and cache pruning
- [ ] offline catalog snapshot / cached-only bisect mode

The manager never rewrites the user's normal Claude binary/symlink. Published release bisection uses the package release catalog as an index, while every native binary is still obtained and authenticated through Canary's release cache.

## v0.3 — Configuration experiments

- [x] `CLAUDE.md` / `CLAUDE.local.md` A/B tests
- [x] isolated project/local settings overlays
- [x] rules and hook-directory variants
- [x] local plugin directory / zip variants
- [x] strict MCP configuration variants
- [x] repeated interleaved trials and aggregate statistics
- [x] pass-rate, token, tool-call, cost and duration deltas
- [x] machine-readable aggregate experiment artifact
- [x] fixture-aware changed-file assertions
- [x] user CLAUDE.md/rules/settings exclusion and auto-memory disable
- [ ] multi-scenario experiment suites
- [ ] confidence/noise warnings for nondeterministic outcomes
- [ ] percentile/median reporting for longer experiment runs

See [`CONFIG_EXPERIMENTS.md`](CONFIG_EXPERIMENTS.md) for the variant layout and isolation model.

## v0.4 — Record and replay

- [x] snapshot a clean repository before a real interactive/headless Claude task
- [x] store pending recorder state outside the working-tree diff under `.git/cc-canary/recordings`
- [x] capture exact starting Git commit and Claude version/model metadata
- [x] capture project configuration presence without raw config/environment values
- [x] redact common secrets and machine-specific absolute paths from persisted prompt metadata
- [x] reject secret-bearing/non-portable setup and verification commands
- [x] derive allow + required changed-file assertions from the successful task
- [x] derive files-exist / files-absent assertions
- [x] generate reviewable editable Canary YAML
- [x] replay from the exact recorded commit in an isolated detached worktree
- [x] allow replay while the current source checkout still contains the successful dirty edits
- [ ] optional one-command headless `record --run` capture
- [ ] interactive prompt handoff/launcher without transcript persistence
- [ ] smarter opt-in content assertion suggestions
- [ ] recording inventory / abort command

See [`RECORD_REPLAY.md`](RECORD_REPLAY.md) for the workflow, privacy model and limitations.

## v0.5 — Reproduction bundles

- [x] `claude-canary repro <result>`
- [x] exact recorded/base Git commit resolution
- [x] minimal fixture repository export from deterministic scenario scope
- [x] hard denylist for credential files, dependency caches and build outputs
- [x] symlink refusal and text-only bounded export
- [x] secret and machine-path redaction
- [x] sanitized scenario and result artifacts without environment values/raw model output
- [x] minimal environment/version manifest
- [x] shell and PowerShell one-command reproduction launchers
- [x] Markdown issue report generator
- [x] fixture export manifest listing exported/redacted/skipped entries
- [x] documented threat model and mandatory review workflow
- [ ] optional opt-in redacted stream-event subset for cases where deterministic metadata is insufficient

See [`REPRO_BUNDLES.md`](REPRO_BUNDLES.md) for the export model, exclusions and publishing safety guidance.

## v0.6 — Plugin compatibility and ecosystem

- [x] `claude-canary plugin-matrix <scenario> --plugin <path>`
- [x] newest-N, explicit-version and published-range selectors
- [x] authenticated per-release executable reuse through the version cache
- [x] same Git starting commit and deterministic scenario for every release
- [x] fresh temporary plugin copy per run instead of exposing the source plugin path
- [x] JSON compatibility artifact
- [x] README-friendly Markdown compatibility table
- [x] first incompatible release marker
- [x] CI-friendly failure semantics with `--allow-incompatible` override
- [x] bounded 50-release safety cap
- [x] `claude-canary plugin-init <plugin-dir>` discovery fixture generator
- [x] commands/agents/skills/hooks/MCP smoke-test scenario generation
- [x] default + manifest custom-path discovery
- [x] inline hook/MCP discovery and frontmatter metadata extraction
- [x] symlink-safe generator isolation and marker-protected `--force`
- [x] `claude-canary plugin-suite --plugin <path>` full generated-suite runner
- [x] release × scenario compatibility matrix with JSON + Markdown artifacts
- [x] per-release and per-scenario aggregate failure summaries
- [x] bounded suite run budget with explicit override
- [ ] multi-plugin workspace compatibility suites
- [ ] reusable GitHub Action mode for plugin suites/matrices
- [ ] Action performance/caching improvements
- [ ] richer badge/reporting integrations

See [`PLUGIN_COMPATIBILITY.md`](PLUGIN_COMPATIBILITY.md) for focused single-scenario matrices, [`PLUGIN_SMOKE_GENERATOR.md`](PLUGIN_SMOKE_GENERATOR.md) for plugin discovery and generated smoke suites, and [`PLUGIN_SUITE.md`](PLUGIN_SUITE.md) for full generated-suite compatibility runs.

## v1.0

- stable scenario schema
- stable JSON result schema
- reporter/plugin API
- backwards-compatible migrations
- documented threat model
- reproducibility guarantees and known sources of nondeterminism

## Non-goals

Canary is not intended to be another chat transcript viewer, generic LLM benchmark leaderboard, or permission-bypass wrapper. Its core job is to answer: **what changed, did it regress, and where did the regression start?**
