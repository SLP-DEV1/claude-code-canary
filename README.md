# Claude Code Canary

[![CI](https://github.com/SLP-DEV1/claude-code-canary/actions/workflows/ci.yml/badge.svg)](https://github.com/SLP-DEV1/claude-code-canary/actions/workflows/ci.yml)
[![Claude Canary Action](https://img.shields.io/badge/GitHub%20Action-Claude%20Canary-yellow?logo=githubactions)](docs/GITHUB_ACTION.md)

**Catch Claude Code regressions before they catch you.**

Claude Code Canary is an open-source regression harness for Claude Code. It runs the same coding scenario in isolated Git worktrees, records deterministic outcomes and agent metrics, and compares Claude Code versions/configurations side by side.

> Status: **early MVP / v0.1 development**. The core runner is usable, but interfaces may still change.

## Why Canary?

Claude Code changes quickly. So do your `CLAUDE.md`, hooks, plugins, MCP servers, skills and permission rules. When behavior changes, it is hard to answer:

- Did the Claude Code update cause the regression?
- Is the new `CLAUDE.md` actually better?
- Did a hook stop firing?
- Did token/tool usage jump?
- Which version first became bad?

Canary turns those questions into repeatable tests.

## What works now

- `claude-canary init` — create a scenario file
- `claude-canary validate` — validate YAML before spending tokens
- `claude-canary run` — run one scenario in a disposable Git worktree
- `claude-canary compare` — compare two executables **or two release versions**
- `claude-canary experiment` — A/B test `CLAUDE.md`, settings, hooks, plugins and MCP configuration with repeated trials
- `claude-canary bisect --good <version> --bad <version>` — automatically find the first bad published Claude Code release
- `claude-canary bisect --commands ...` — binary-search custom Claude executables/wrappers
- `claude-canary versions install|list|path` — isolated historical Claude Code cache
- signed-manifest authentication for Claude Code 2.1.89+
- `claude-canary doctor` — check Git, Claude and repository readiness
- reusable **Claude Canary GitHub Action** with Step Summary and JSON artifact upload
- deterministic verification commands
- changed-file allow/deny rules
- expected/forbidden file and content assertions
- max tool-call / token / cost limits
- `stream-json` capture with tool-use and usage metrics
- JSON result artifacts for CI and later analysis

## Quick start

Requirements:

- Node.js 20+
- Git
- Claude Code authenticated (your normal installation can remain untouched)

```bash
npm install
npm run build
npm link

cd /path/to/project
claude-canary init
claude-canary run .canary/basic.canary.yml
```

Canary deliberately uses Claude Code's documented non-interactive CLI (`claude -p`) and `stream-json` output instead of scraping the interactive terminal UI.

## GitHub Action

Run Canary on pull requests and make regressions visible as normal GitHub checks:

```yaml
name: Claude Canary

on:
  pull_request:
  workflow_dispatch:

jobs:
  regression-check:
    runs-on: ubuntu-latest
    env:
      ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: SLP-DEV1/claude-code-canary@main
        with:
          scenario: .canary/basic.canary.yml
          from: 2.1.89
          to: latest
```

The Action writes the comparison to the GitHub Actions Step Summary, fails when the candidate fails the scenario, and uploads `.canary/results/*.json` as an artifact.

Add a live status badge to the repository that uses Canary:

```md
[![Claude Canary](https://github.com/OWNER/REPO/actions/workflows/claude-canary.yml/badge.svg)](https://github.com/OWNER/REPO/actions/workflows/claude-canary.yml)
```

See [`docs/GITHUB_ACTION.md`](docs/GITHUB_ACTION.md) for inputs, security notes, a Shields.io badge variant and the full setup. A copy-ready workflow also lives at [`examples/github-actions/claude-canary.yml`](examples/github-actions/claude-canary.yml).

## Compare actual Claude Code releases

Canary can keep multiple native Claude Code binaries in its own cache. It resolves exact versions or the `stable` / `latest` channels from Anthropic's official release distribution.

For Claude Code 2.1.89 and newer, Canary verifies Anthropic's detached release-manifest signature against a hard-pinned signing-key fingerprint **before** trusting the binary checksum. Older releases are clearly marked `checksum-only` because Anthropic did not publish detached manifest signatures for them.

```bash
claude-canary versions install 2.1.89
claude-canary versions list

claude-canary compare .canary/basic.canary.yml \
  --from 2.1.89 \
  --to latest
```

Missing versions are cached automatically. Canary **does not replace or downgrade your normal `claude` installation**.

See [`docs/VERSION_MANAGER.md`](docs/VERSION_MANAGER.md) for the cache layout and trust model.

## A/B test Claude Code configuration

Measure whether a new Claude Code setup actually improves the same deterministic scenario instead of judging it by feel.

Create two variant directories, for example:

```text
.canary/variants/
  current/
    CLAUDE.md
  candidate/
    CLAUDE.md
    .claude/settings.json
    .mcp.json
```

Then run repeated, interleaved trials:

```bash
claude-canary experiment .canary/basic.canary.yml \
  --baseline-config .canary/variants/current \
  --candidate-config .canary/variants/candidate \
  --runs 5
```

Canary keeps the Git starting state and scenario identical while varying controlled Claude Code configuration. It reports pass rate plus average tool calls, tokens, cost and duration, and writes a machine-readable aggregate artifact without copying variant contents or environment values into it.

Experiment variants can control project `CLAUDE.md` / `CLAUDE.local.md`, project/local settings, rules, hooks, MCP config and local plugins. User configuration and auto memory are excluded from experiment runs where Claude Code provides controls for doing so; managed organization policy remains effective.

Copy-ready example variants live under [`examples/config-experiment/`](examples/config-experiment/). See [`docs/CONFIG_EXPERIMENTS.md`](docs/CONFIG_EXPERIMENTS.md) for the complete variant layout, isolation guarantees and nondeterminism guidance.

## Find the first bad Claude Code release

Give Canary one known-good and one known-bad published release:

```bash
claude-canary bisect .canary/basic.canary.yml \
  --good 2.1.220 \
  --bad 2.1.237
```

Canary reads the real published Claude Code release catalog, respects version-number gaps, authenticates only the releases needed by binary search, runs the same scenario from the same repository state, and reports the first published release that fails.

```text
Claude Code Canary — release bisect

PASS  2.1.220
FAIL  2.1.237
PASS  2.1.228
FAIL  2.1.233
PASS  2.1.231
FAIL  2.1.232

First bad release: 2.1.232
```

It does **not** run every intermediate release. The search is logarithmic, so a range containing dozens of releases typically needs only a handful of actual Claude runs.

Like `git bisect`, release bisection assumes a monotonic transition: the scenario is good before some boundary and bad from that boundary onward. Flaky scenarios or regressions that disappear and later reappear can mislead binary search; stabilize or repeat the scenario before trusting the boundary.

## Scenario format

```yaml
version: 1
name: fix-auth-regression

prompt: |
  Fix the failing authentication test.
  Do not change the public API.

setup:
  commands:
    - npm ci

claude:
  executable: claude
  model: sonnet
  permission_mode: dontAsk
  max_turns: 20
  max_budget_usd: 5
  timeout_seconds: 900

verify:
  commands:
    - npm test

expect:
  changed_files:
    allow:
      - src/auth/**
      - test/auth/**
    deny:
      - package-lock.json
  files_exist:
    - src/auth/index.ts
  files_absent: []
  file_contains:
    - path: src/auth/index.ts
      text: authenticate

limits:
  max_tool_calls: 100
  max_total_tokens: 200000
  max_cost_usd: 5
```

A scenario passes only when Claude exits successfully **and** every deterministic assertion passes.

## Compare custom Claude builds/wrappers

You can still point Canary at any two executables:

```bash
claude-canary compare .canary/basic.canary.yml \
  --baseline /opt/claude/old/claude \
  --candidate /opt/claude/new/claude
```

Example output:

```text
Claude Code Canary — compare

Metric                 baseline     candidate
Result                 PASS         FAIL
Tool calls             42           57
Total tokens           81,204       103,912
Cost                   $1.42        $1.91
Duration               2m 13s       2m 41s

Candidate regression detected.
```

## Bisect custom executables

If you have custom Claude wrappers/builds rather than published release numbers:

```bash
claude-canary bisect .canary/basic.canary.yml --commands \
  ./claude-good \
  ./claude-middle-a \
  ./claude-middle-b \
  ./claude-bad
```

Canary verifies the first command is good and the last is bad, then binary-searches that ordered list.

## Safety model

Canary isolates **files**, not your whole machine. Each run uses a disposable detached Git worktree, but commands executed by Claude or scenario setup/verification still run with your OS account permissions.

For untrusted repositories or aggressive permission settings, run Canary inside a container/VM. Canary defaults to conservative behavior and never enables `bypassPermissions` for you.

The version cache authenticates signed manifests for Claude Code 2.1.89+ with Anthropic's pinned release-signing fingerprint, then verifies binary SHA256 and size. Pre-2.1.89 releases are explicitly reported as checksum-only.

## Result artifacts

Each run writes a JSON result under:

```text
.canary/results/<timestamp>-<scenario>.json
```

The artifact contains pass/fail, assertion failures, Claude exit status, changed files, verification command summaries, duration, tool-call count, token usage, cost and captured hook-event names when available. Raw model text is not copied into the summary artifact by default.

Configuration experiments additionally write an aggregate `*-experiment.json` artifact with per-variant pass-rate and efficiency metrics.

## Roadmap

1. **v0.1 — deterministic harness**: run, compare, bisect, metrics, CI, GitHub Action
2. **v0.2 — version intelligence**: signed isolated historical binaries + automatic published-release bisect
3. **v0.3 — configuration experiments**: A/B testing core shipped; multi-scenario suites and noise/confidence reporting next
4. **v0.4 — record/replay**: turn a real Claude task into a reusable regression scenario
5. **v0.5 — repro bundles**: export a minimal redacted bug reproduction
6. **v0.6 — ecosystem**: plugin compatibility matrix, Action refinements and badge/reporting integrations
7. **v1.0 — stable scenario schema and reporter API**

See [`docs/ROADMAP.md`](docs/ROADMAP.md) for details.

## Design principles

- **Deterministic first.** Prefer test commands and filesystem assertions over LLM-as-judge.
- **Same starting state.** Comparisons run from the same Git commit in separate worktrees.
- **No hidden permissions.** Canary does not silently weaken Claude Code security settings.
- **Useful failures.** A regression report should be attachable to an upstream bug report.
- **Provider-specific on purpose.** Canary targets Claude Code deeply rather than being a shallow generic agent benchmark.

## Development

```bash
npm install
npm test
npm run build
npm run lint
```

## Contributing

Issues and PRs are welcome. Please read [`CONTRIBUTING.md`](CONTRIBUTING.md).

## License

MIT
