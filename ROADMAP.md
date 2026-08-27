# Claude Code Canary Roadmap

Claude Code Canary exists to answer one question reliably:

> **What broke, when did it break, and can I prove it without guessing?**

The project is already beyond basic single-scenario regression testing. Canary can run and compare deterministic scenarios, bisect Claude Code releases, test plugins across release matrices, snapshot/check MCP contracts, observe agent-team behavior, run configuration experiments, validate committed baselines, export reproduction bundles, and preflight extension compatibility with `doctor`.

This roadmap therefore starts **after v1.2** and focuses on the next product gap: turning those individual capabilities into an automated compatibility system that can continuously detect new Claude Code regressions, explain them, and publish portable evidence.

Current stable release: see the [latest GitHub release](https://github.com/SLP-DEV1/claude-code-canary/releases/latest), [npm](https://www.npmjs.com/package/claude-code-canary), and the [GitHub Marketplace Action](https://github.com/marketplace/actions/claude-code-canary).

---

## Product principles

Every roadmap item should preserve these constraints:

- **Real Claude Code behavior over synthetic benchmarks.** Canary is not an LLM leaderboard.
- **Deterministic evidence over subjective grading.** Prefer assertions, lifecycle events, schemas, diffs, metrics and exit categories.
- **Exact-version reproducibility.** A failure must be replayable against the exact Git commit and Claude Code release that produced it.
- **Local-first and CI-friendly.** Core functionality must not depend on a hosted Canary service.
- **Privacy by default.** Portable artifacts should exclude prompts, transcripts, credentials and raw environment values unless a user explicitly chooses otherwise.
- **Fail closed around integrity.** Unknown release metadata, malformed contracts, unsafe fixture export and incompatible baselines should not silently pass.
- **Composable surfaces.** Scenarios, plugins, MCP servers, hooks, permissions, subagents, agent teams and gateways should feed one compatibility model rather than become unrelated tools.
- **No hidden side effects.** Discovery, reporting and compatibility checks should stay read-only unless a command explicitly documents an isolated mutation boundary.

---

## Milestone overview

| Milestone | Theme | Flagship outcome |
| --- | --- | --- |
| **v1.3** | Release Watch & Suite Orchestration | A scheduled CI job can detect a new Claude Code release, run the right scenarios and automatically identify the first bad release. |
| **v1.4** | Reports & CI Interoperability | Canary results become immediately useful in GitHub, JUnit consumers and a portable static HTML report. |
| **v1.5** | Portable Compatibility Ecosystem | Plugins/projects can publish machine-readable known-good compatibility evidence without a central Canary cloud. |
| **v1.6** | Policy & Trust Regression Testing | Permissions, hooks, monitors, MCP side effects and gateway differences become explicit regression surfaces. |
| **v2.0** | Compatibility Intelligence | Canary can answer compatibility questions across releases, components and scenario packs through stable public schemas and APIs. |

The release numbers describe product sequence, not calendar commitments. Small fixes and maintenance releases may ship between these milestones.

---

# v1.3 — Release Watch & Suite Orchestration

**Goal:** make Canary useful as an always-ready release guard instead of a collection of commands users must manually orchestrate.

## P0 — Claude Code release watcher

Add a first-class command for detecting and testing newly published Claude Code releases.

```bash
claude-canary watch --suite .canary/release.suite.yml
```

Planned behavior:

- query Canary's verified Claude Code release catalog;
- persist only small non-secret state such as the last observed and last known-good release;
- do nothing when no new release exists;
- run the configured suite when a new stable release appears;
- compare the new release against the previous known-good release;
- automatically invoke release bisection when multiple unseen releases exist and the newest one fails;
- produce Markdown and JSON evidence containing the tested releases, failed scenarios, failure fingerprints and first bad release;
- return stable exit codes that distinguish `no change`, `compatible`, `regression`, `infrastructure failure` and `invalid configuration`;
- support `--check-only` / dry-run behavior that never launches Claude;
- work naturally from `workflow_dispatch` or a scheduled GitHub Actions workflow without requiring a daemon or hosted Canary service.

Example CI direction:

```yaml
- uses: SLP-DEV1/claude-code-canary@v1
  with:
    mode: watch
    suite: .canary/release.suite.yml
```

**Acceptance:** a repository can run Canary on a schedule, detect a newly published Claude Code release exactly once, execute its release gate and report the first bad release without a maintainer manually selecting versions.

## P0 — First-class scenario suites

Introduce one suite format for ordinary scenarios instead of forcing shell-level orchestration.

```yaml
version: 1
name: release-gate
include:
  - .canary/**/*.canary.yml
exclude:
  - .canary/slow/**
tags:
  - release
concurrency: 2
```

CLI direction:

```bash
claude-canary suite .canary/release.suite.yml
claude-canary suite .canary/release.suite.yml --tag mcp
claude-canary suite .canary/release.suite.yml --shard 2/4
claude-canary suite .canary/release.suite.yml --list
```

Required capabilities:

- include/exclude globs;
- scenario tags;
- bounded concurrency;
- deterministic sharding;
- fail-fast or complete-all modes;
- global maximum run budget;
- one combined Markdown/JSON result;
- stable ordering independent of filesystem traversal;
- explicit distinction between scenario failure and runner/infrastructure failure.

Suites should eventually become the common input for `watch`, reporting and compatibility manifests.

**Acceptance:** a 100-scenario repository can split the same deterministic suite across multiple CI workers and combine the results without changing which scenarios belong to the suite.

## P0 — Stability / flakiness analysis

`experiment` already measures repeated A/B configuration runs. Add a dedicated stability mode for one scenario or suite.

```bash
claude-canary flake .canary/auth.canary.yml --runs 10
```

Report:

- pass rate;
- assertion-specific failure frequency;
- changed-file-set variance;
- hook / permission sequence variance;
- tool-call and token variance;
- duration variance;
- deterministic classification such as `stable`, `noisy` or `flaky`.

Example policy:

```yaml
stability:
  min_pass_rate: 0.9
  max_changed_file_variants: 1
```

No LLM should be used to decide whether a scenario is flaky.

**Acceptance:** Canary can prevent a noisy scenario from being mistaken for a new Claude Code regression and can show exactly which observable dimension is unstable.

## P0 — Failure fingerprints

Generate a deterministic fingerprint from observable failure evidence.

Candidate inputs:

- failed assertion IDs;
- exit/error category;
- tool sequence shape;
- permission event shape;
- hook lifecycle sequence;
- changed-file set;
- failed plugin/MCP/team component;
- MCP contract fingerprint;
- stable normalized error identifiers.

Use those fingerprints to group the same break across many scenarios/releases.

**Acceptance:** one upstream regression that breaks 40 scenarios can be presented as one failure family with 40 affected cases instead of 40 unrelated incidents.

## P1 — Selective scenario execution

Allow scenarios to declare which repository paths can affect them.

```yaml
affects:
  - src/auth/**
  - package.json
```

`pr-check` and suites can then skip unrelated expensive scenarios while always honoring globally tagged safety/release gates.

**Acceptance:** selective execution is deterministic, explainable (`why this scenario ran/skipped`) and never silently excludes globally required scenarios.

## P1 — Safe result reuse

Introduce an optional local/CI cache keyed by compatibility-relevant inputs such as:

- scenario hash;
- Git commit;
- exact Claude Code version;
- Canary result schema version;
- platform/runtime compatibility metadata;
- non-secret feature flags.

A cache hit must be rejected when any compatibility input differs.

**Acceptance:** repeated matrix/suite runs can avoid identical work without allowing stale results to masquerade as new evidence.

### v1.3 exit criteria

v1.3 is complete when a maintainer can install Canary, define one suite, schedule one workflow and receive a deterministic report whenever a new Claude Code release changes behavior.

---

# v1.4 — Reports & CI Interoperability

**Goal:** make Canary failures understandable without opening raw JSON or scrolling through long Actions logs.

## P0 — Portable static HTML report

```bash
claude-canary report .canary/results --format html
```

Generate a backend-free report directory containing:

- release compatibility matrix;
- suite pass/fail overview;
- first-bad-release result;
- failure fingerprint groups;
- assertion failures;
- token/tool/reported-cost/duration deltas;
- permission and hook timelines;
- changed-file summary;
- plugin/MCP/agent-team component status;
- links to the local source result artifacts.

The report must remain useful offline and must not embed secrets, environment values or raw prompts by default.

## P0 — JUnit XML

```bash
claude-canary suite .canary/release.suite.yml --junit canary-junit.xml
```

Map deterministic assertion failures to test cases while keeping infrastructure failures distinguishable from product regressions.

## P0 — GitHub Action summary/reporting modes

Extend the Action so suite/watch runs produce concise GitHub job summaries containing:

- tested Claude Code versions;
- scenario counts;
- first bad release when known;
- grouped failure fingerprints;
- links to uploaded JSON/HTML artifacts.

Do not require PR comments when a job summary is sufficient.

## P1 — SARIF / GitHub Checks annotations

Emit precise annotations only when Canary has a real source location, such as:

- invalid scenario/config entries;
- assertion declarations tied to a file;
- plugin manifest/schema problems;
- contract files.

Do not invent line numbers for agent-level behavioral failures.

## P1 — Baseline review workflow

Build on committed baselines with an explicit lifecycle:

- explain which metric/assertion changed;
- generate a proposed baseline patch;
- never update a baseline silently;
- optionally upload the patch as an Action artifact;
- preserve scenario hash and compatibility metadata;
- distinguish `accepting a new expected value` from `hiding a regression` in the report.

## P1 — Historical local trend view

Aggregate saved artifacts into a local trend report:

- pass rate by Claude Code release;
- median/p95 token usage;
- tool-call and duration trends;
- repeated failure fingerprints;
- known-good / known-bad windows.

No telemetry upload is required.

### v1.4 exit criteria

A failed Canary job should be understandable from the GitHub summary or static report without requiring the maintainer to manually interpret raw result JSON.

---

# v1.5 — Portable Compatibility Ecosystem

**Goal:** let projects publish trusted compatibility evidence that other tools and users can consume without creating a central Canary SaaS dependency.

## P0 — Compatibility manifest

Generate a minimal non-sensitive artifact for a tested component/suite combination.

```json
{
  "schema": 1,
  "canary": "1.x",
  "claudeCode": "2.x.y",
  "component": "example-plugin@1.4.0",
  "platform": "linux-x64",
  "suiteHash": "...",
  "result": "pass"
}
```

The schema must forbid prompts, transcripts, credentials and raw environment values.

## P0 — `canary.lock`

Introduce an optional compatibility lockfile recording the last reviewed known-good envelope:

- Canary version/schema;
- Claude Code release;
- suite/scenario hashes;
- plugin/component versions;
- relevant non-secret feature flags;
- compatibility manifest fingerprints.

Example use:

```bash
claude-canary lock update --suite .canary/release.suite.yml
claude-canary lock check
```

CI can then fail clearly when the runtime drifts outside the tested envelope.

## P0 — Open registry format

Define an open JSON index format that projects can publish themselves through:

- GitHub Releases;
- GitHub Pages;
- ordinary static hosting;
- CI artifacts mirrored to a stable URL.

Canary may consume multiple registries but should not require a canonical hosted Canary registry.

Possible CLI:

```bash
claude-canary compat check ./my-plugin
claude-canary compat versions ./my-plugin
```

## P1 — Compatibility badges

Generate a stable badge endpoint/file strategy from published manifests so plugin authors can show, for example:

- newest tested Claude Code release;
- tested release range;
- suite result;
- last verification time.

Badges must be derived from evidence, not manually claimed compatibility.

## P1 — Community scenario packs

Support reusable versioned packs for generic surfaces:

- hooks;
- permissions;
- MCP transports/tool search;
- plugin loading;
- LSP;
- monitors;
- agent teams.

Packs must be inspectable before execution and must declare network/mutation requirements explicitly.

### v1.5 exit criteria

A plugin author can publish compact compatibility evidence from CI, and another user can query that evidence without sharing transcripts or depending on a Canary-operated cloud service.

---

# v1.6 — Policy & Trust Regression Testing

**Goal:** make security-relevant behavior changes visible before they become production surprises.

## P0 — Permission-policy coverage maps

Build on Canary's real permission prompt/event capture.

For a scenario/suite, report which operations were:

- auto-allowed;
- prompted;
- denied;
- never exercised.

Policy direction:

```yaml
policy:
  never_auto_allow:
    - Bash(rm *)
    - mcp__github__merge_pull_request
  require_prompt:
    - Bash(git push *)
```

The feature is for regression detection, not permission bypass.

## P0 — Side-effect-safe MCP fixture pack

Provide local deterministic MCP fixtures for:

- read-only tools;
- isolated writes;
- malformed schemas;
- timeouts;
- reconnects;
- dynamic tool/resource changes;
- pagination;
- unsafe/mutating annotations.

Any mutating fixture must be restricted to Canary-owned temporary state/worktrees.

## P1 — Hook and monitor trust tests

Hooks and monitors can execute outside the ordinary model loop. Add explicit opt-in scenarios that verify:

- startup count;
- expected event ordering;
- timeout behavior;
- shutdown behavior;
- duplicate execution;
- unexpected execution after a Claude Code upgrade.

Monitor execution should never become an implicit side effect of ordinary plugin discovery.

## P1 — Gateway/provider compatibility matrix

Add an opt-in matrix for Claude Code-compatible environments where observable behavior may differ:

- first-party Claude Code;
- compatible `ANTHROPIC_BASE_URL` gateways;
- Bedrock / Vertex / Foundry when credentials are available to the runner;
- Tool Search availability;
- streaming/event differences;
- reported token/cost metadata availability.

Third-party providers must never become a requirement for core Canary functionality.

## P1 — Reproduction integrity

Strengthen repro/result portability with:

- explicit schema versions;
- artifact fingerprints;
- optional detached signatures/checksums;
- a `verify` command that validates a result/repro bundle before it is trusted;
- clear distinction between locally produced, CI-produced and externally downloaded evidence.

### v1.6 exit criteria

Canary can prove when a Claude Code update changes permission, hook, monitor or MCP trust behavior without executing unbounded real-world side effects.

---

# v2.0 — Compatibility Intelligence

**Goal:** turn isolated regression evidence into a stable compatibility model that tools, plugins and CI systems can query programmatically.

## P0 — Stable public result schemas

Promote the major Canary result formats to versioned public contracts:

- scenario result;
- suite result;
- watch result;
- failure fingerprint;
- compatibility manifest;
- plugin/MCP/team compatibility result.

Breaking schema changes after v2.0 require explicit versioning/migration rather than silent field changes.

## P0 — Compatibility query engine

Given local or remote manifests/results, answer deterministic questions such as:

```bash
claude-canary compat latest-good ./my-plugin
claude-canary compat first-bad ./my-plugin
claude-canary compat explain ./my-plugin --from 2.1.120 --to 2.1.130
```

Answers should cite the concrete evidence artifacts used to reach the conclusion.

## P0 — Compatibility graph

Represent the tested relationship between:

- Claude Code release;
- Canary version/schema;
- project Git commit;
- plugin/component version;
- suite hash;
- platform;
- non-secret feature flags;
- pass/failure fingerprint.

This graph should work locally from files first. A hosted visualization can exist later, but it must not be required.

## P1 — Multi-project/workspace aggregation

Allow organizations maintaining several Claude Code plugins/projects to aggregate compatible results without merging their repositories or exposing source code.

## P1 — Public TypeScript API stability

Turn the existing exported APIs into a clearly supported programmatic surface for build tools and ecosystem integrations, including compatibility helpers, result parsing and schema validation.

### v2.0 exit criteria

Canary is no longer only a command runner. It becomes a reproducible compatibility evidence format and query layer while retaining the local-first model that differentiates the project.

---

# Continuous adoption track

These items should ship alongside feature milestones rather than wait for a specific version:

- keep the npm package, GitHub Action and Marketplace listing synchronized;
- keep `@v1` consumer-smoke tested after every release;
- maintain one copy-paste minimal example for ordinary scenarios, plugins and MCP contracts;
- add real-world example repositories when they demonstrate behavior that cannot be shown clearly in unit fixtures;
- keep README setup under roughly one minute for the simplest use case;
- submit to high-quality Claude Code / agent tooling directories when their contribution rules are met;
- publish concise release notes that lead with the problem solved, not an internal commit list;
- keep dynamic version/download/release badges rather than hard-coded release text;
- continuously test documentation links and packaged consumer installation.

Growth should come from making Canary useful and easy to verify, not from adding unrelated features for search keywords.

---

# Maintenance track

Ship continuously:

- track Claude Code release manifest/signature changes and fail closed on unverifiable releases;
- test latest supported Node versions and keep the published runtime floor explicit;
- update plugin/MCP/team fixtures as upstream schemas evolve;
- keep Action inputs/outputs, CLI help, schemas, README examples and package metadata synchronized;
- preserve privacy-safe defaults in every new artifact format;
- audit stale issues and roadmap entries after each feature release;
- keep dependency/security scanning and package provenance healthy;
- add regression tests for every confirmed Canary bug before closing it.

---

# Explicit non-goals

Unless the project direction intentionally changes, Canary should **not** become:

- a generic LLM benchmark or leaderboard;
- a cloud-only SaaS requirement;
- a prompt/transcript warehouse;
- an autonomous coding or code-review agent;
- a tool for bypassing Claude Code permissions;
- a production secret/log observability backend;
- a replacement for Claude Code itself;
- a compatibility database that accepts unverified claims as equivalent to reproducible test evidence.

Those directions dilute Canary's strongest differentiator: **deterministic compatibility and regression evidence for real Claude Code workflows.**

---

# Recommended implementation order

1. **Release watcher**
2. **Scenario suites + sharding/concurrency**
3. **Stability/flakiness analysis**
4. **Failure fingerprints**
5. **Selective execution + safe result reuse**
6. **Static HTML + JUnit + GitHub summaries**
7. **Compatibility manifest + `canary.lock`**
8. **Open registry format + scenario packs**
9. **Permission-policy / MCP / hook trust regression gates**
10. **Stable v2 compatibility schemas and query engine**

The first four items should stay tightly coupled: **watch** tells Canary *when* to test, **suite** tells it *what* to test, **flake** tells it *whether the signal is trustworthy*, and **fingerprints** tell it *whether many failures are actually the same regression*.
