# Claude Code Canary Roadmap

Claude Code Canary is a regression layer for real Claude Code workflows. The roadmap intentionally prioritizes compatibility signals that can be measured deterministically over generic benchmarks or model leaderboards.

Current stable release: **v1.1.0**.

## Product principles

- Test real Claude Code behavior, not synthetic model trivia.
- Prefer deterministic assertions and observable lifecycle events over subjective scoring.
- Keep runs reproducible from an exact Git commit.
- Stay local-first and CI-friendly. No hosted service should be required for core functionality.
- Fail closed around release integrity, fixture export and secret handling.
- Treat plugins, MCP servers, hooks, permissions, subagents and agent teams as first-class compatibility surfaces.
- Keep raw transcripts and credentials out of portable artifacts by default.

---

## v1.2 — Compatibility Surfaces

**Goal:** cover the Claude Code extension surfaces most likely to break across releases.

### P0 — MCP contract testing *(implemented for v1.2)*

Add first-class regression tests for MCP servers and Claude Code's MCP integration.

Planned capabilities:

- snapshot exposed MCP tools, prompts and resources
- compare tool names and JSON schemas between runs
- assert expected tool discovery and tool selection
- test `list_changed` capability refreshes
- test Tool Search enabled / disabled / threshold modes
- detect unexpected context/token growth caused by MCP schema loading
- classify connection, timeout and reconnect failures separately from task failures
- provide deterministic local mock MCP fixtures so contract tests do not need real external side effects
- optionally assert that mutating MCP tools are never invoked in read-only scenarios

Example direction:

```bash
claude-canary mcp-check .canary/mcp/github.canary.yml
claude-canary mcp-compare .canary/mcp/github.canary.yml --base 2.1.120 --candidate latest
```

**Acceptance:** a server schema change, a missing tool, a Tool Search regression or an unexpected mutating invocation can fail CI without depending on subjective output grading.

### P0 — Plugin surface coverage: LSP, monitors and dependencies

Extend `plugin-init`, `plugin-matrix` and `plugin-suite` beyond skills/commands/hooks/MCP.

Planned coverage:

- `.lsp.json` discovery and load validation
- LSP smoke scenarios for definition lookup, references and diagnostics
- monitor startup, notification delivery and clean shutdown
- monitor availability/unsupported-host reporting
- plugin dependency resolution and semver constraints
- plugin marketplace `strict` behavior
- plugin source pinning and cache/update compatibility
- clear `unsupported`, `skipped`, `failed` and `passed` states instead of collapsing all non-passes together

**Acceptance:** a plugin author can run one suite and see whether every supported component still loads and behaves correctly across recent Claude Code releases.

### P0 — Agent-team regression testing

Add deterministic observability for Claude Code agent teams while keeping the feature explicitly marked experimental when upstream marks it experimental.

Planned signals:

- teammate spawn count and identities/types
- task assignment and completion states
- unexpected duplicate/orphaned teammates
- inter-agent message counts and ordering where observable
- team completion vs lead-only completion
- total turns/tokens/tool calls across the team
- coordination latency and timeout classification
- base-vs-candidate regression thresholds for team fan-out and resource use

**Acceptance:** Canary can detect that a Claude Code release changed delegation/coordination behavior even when the final file output still passes.

### P1 — Extension compatibility doctor

Expand `doctor` into a machine-readable environment preflight.

```bash
claude-canary doctor --json
```

Report only non-secret compatibility metadata:

- Claude Code version and executable source
- Canary version
- Node/platform/architecture
- configured plugin component types
- MCP transport availability
- required external binaries for LSP/plugin scenarios
- experimental feature flags relevant to a scenario
- warnings for unsupported host/provider feature combinations

---

## v1.3 — Suite Scale and Signal Quality

**Goal:** make Canary practical for repositories with dozens or hundreds of scenarios.

### P0 — First-class scenario suites

Add suite files and CLI selection instead of requiring users to orchestrate individual scenarios themselves.

```yaml
version: 1
name: release-gate
include:
  - .canary/auth/*.canary.yml
  - .canary/plugins/*.canary.yml
exclude:
  - '**/slow-*'
tags: [release]
```

Planned CLI:

```bash
claude-canary suite .canary/release.suite.yml
claude-canary suite .canary/release.suite.yml --tag mcp
claude-canary suite .canary/release.suite.yml --shard 2/4
```

Features:

- include/exclude globs
- tags
- bounded concurrency
- sharding for CI
- fail-fast or complete-all modes
- combined Markdown/JSON report
- stable exit codes for partial/infra/test failures

### P0 — Flakiness detector

A deterministic regression system needs to distinguish a real regression from a noisy scenario.

```bash
claude-canary flake .canary/auth.canary.yml --runs 10
```

Report:

- pass rate
- assertion-specific failure frequency
- token/tool/duration variance
- changed-file variance
- hook/permission sequence variance
- confidence classification such as stable / noisy / flaky

Allow CI policy such as:

```yaml
stability:
  min_pass_rate: 0.9
  max_changed_file_variants: 1
```

### P0 — Failure fingerprints and clustering

Generate deterministic fingerprints from observable failure data rather than using an LLM to guess root cause.

Inputs can include:

- failed assertion IDs
- exit/error category
- tool sequence shape
- permission events
- hook lifecycle sequence
- changed-file set
- MCP/agent/plugin component that failed

Use the fingerprint to group repeated failures across releases and scenarios so one upstream break does not look like 40 unrelated failures.

### P1 — Selective execution

Allow scenarios to declare dependency paths and run only impacted scenarios on a PR.

```yaml
affects:
  - src/auth/**
  - package.json
```

`pr-check` can then skip unrelated expensive scenarios while always running globally tagged safety/release gates.

### P1 — Baseline lifecycle workflow

Build on v1.1 committed baselines:

- show why a baseline changed
- generate an explicit baseline-update patch
- refuse silent baseline mutation
- optional GitHub Action artifact or PR comment with the proposed update
- retain scenario hash and environment compatibility metadata

---

## v1.4 — Reports and CI Interoperability

**Goal:** make Canary results useful without reading raw JSON or long CI logs.

### P0 — Static HTML report

Generate a single portable report directory with no backend requirement.

```bash
claude-canary report .canary/results --format html
```

Views:

- release comparison overview
- pass/fail matrix
- token/tool/cost/duration deltas
- permission and hook timeline
- changed-file diff summary
- failure fingerprint groups
- plugin/MCP/agent-team component status
- links to the exact local result artifacts

The report must not embed secrets or raw environment values.

### P0 — JUnit output

Support test systems that already understand JUnit XML.

```bash
claude-canary suite ... --junit canary-junit.xml
```

Map deterministic assertion failures to test cases and keep infrastructure failures distinguishable from product regressions.

### P1 — SARIF / GitHub Checks annotations

Where a failure maps to a concrete repository file or assertion source, emit machine-readable annotations that GitHub can surface directly in a PR.

Do not invent line numbers for agent-level failures that have no precise source location.

### P1 — Historical local trend reports

Optionally aggregate committed or downloaded result artifacts into a local trend view:

- pass rate by Claude Code release
- median/p95 tokens
- median/p95 tool calls
- duration trends
- repeated failure fingerprints

No telemetry upload is required.

---

## v1.5 — Policy, Security and Gateway Compatibility

**Goal:** turn behavior that is security-relevant but currently hard to notice into explicit regression gates.

### P0 — Permission-policy coverage maps

Build on the v1.1 permission probe.

For a suite, report which requested operations were:

- automatically allowed
- explicitly requested
- denied
- never exercised

Allow policy assertions such as:

```yaml
policy:
  never_auto_allow:
    - Bash(rm *)
    - mcp__github__merge_pull_request
  require_prompt:
    - Bash(git push *)
```

The purpose is regression detection, not bypassing Claude Code permissions.

### P0 — Side-effect-safe MCP fixtures

Provide reusable local MCP fixtures for read, write, timeout, malformed-schema, dynamic-tool and reconnect scenarios. Mutating fixtures operate only inside Canary's disposable worktree/test process.

This gives plugin/MCP authors a common compatibility test corpus without touching real services.

### P1 — Monitor and hook trust regression tests

Hooks and monitors can execute outside the model loop. Add scenarios that prove expected startup, execution, timeout and shutdown behavior and detect accidental additional executions after an upstream change.

### P1 — Gateway/provider compatibility matrix

Canary already works through Claude Code-compatible gateways. Add an explicit matrix layer for environments where feature behavior differs.

Possible dimensions:

- first-party Claude Code
- compatible `ANTHROPIC_BASE_URL` gateways
- Bedrock / Vertex / Foundry when available to the runner
- Tool Search availability
- streaming/event differences
- reported token/cost metadata availability

Keep this opt-in and never make third-party providers a core dependency.

---

## v2.0 — Compatibility Intelligence

**Goal:** turn isolated regression runs into reusable ecosystem knowledge without turning Canary into a hosted transcript service.

### P0 — Portable compatibility manifest

Generate a small, non-sensitive artifact summarizing a tested combination:

```json
{
  "canary": "2.x",
  "claudeCode": "2.x.y",
  "component": "example-plugin@1.4.0",
  "platform": "linux-x64",
  "suiteHash": "...",
  "result": "pass"
}
```

It must contain no prompts, transcripts, environment values or credentials.

### P0 — Opt-in compatibility registry format

Define an open JSON schema that projects can publish themselves through GitHub Pages/releases/artifacts. Canary can consume multiple registries without requiring a central Canary service.

Use cases:

- plugin authors publish tested Claude Code versions
- marketplaces show compatibility badges
- users query the newest known-good Claude Code release for a plugin

Possible CLI:

```bash
claude-canary compat check ./my-plugin
claude-canary compat badge ./my-plugin
```

### P1 — Community scenario packs

Allow reusable, versioned scenario packs for generic surfaces such as:

- hooks
- MCP transports/tool search
- plugin loading
- LSP
- monitors
- permissions
- agent teams

Packs must be inspectable before execution and may not silently execute network or destructive actions.

### P1 — Compatibility lockfile

Introduce an optional `canary.lock` that records the exact tested compatibility envelope:

- Canary version
- Claude Code release
- scenario/suite hashes
- plugin versions
- relevant non-secret feature flags

CI can fail with a clear message when the runtime drifts outside that known-tested envelope.

---

## Maintenance track

These are not headline features, but they should ship continuously:

- keep Claude Code release manifest/signature handling compatible and fail closed
- continuously syntax/live-test the latest Claude Code release
- update generated plugin fixtures as upstream plugin schemas evolve
- keep Node 20+ support until there is a strong reason for a major-version runtime bump
- audit stale issues after each release and close issues whose acceptance criteria are already implemented
- keep README examples, Action inputs and npm package metadata synchronized with the current release

## Explicit non-goals

Unless the project direction changes, Canary should **not** become:

- a generic LLM leaderboard
- a cloud-only SaaS requirement
- a transcript warehouse
- an autonomous code-review bot
- a secret-bearing production observability service
- a tool for bypassing Claude Code permissions

Those directions would dilute the project's strongest differentiator: deterministic compatibility and regression testing for real Claude Code workflows.

## Recommended implementation order

1. MCP contract testing
2. LSP / monitor / plugin dependency coverage
3. Agent-team regression signals
4. Scenario suites + sharding
5. Flakiness detection
6. Failure fingerprints
7. Static HTML + JUnit reports
8. Permission-policy coverage
9. Gateway compatibility matrix
10. Portable compatibility manifests / registry

The first three items are the strongest near-term differentiators because Claude Code now exposes MCP Tool Search, LSP-backed code intelligence, plugin monitors and agent teams as distinct behavior surfaces that can regress independently of final task output.
