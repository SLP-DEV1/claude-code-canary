# Claude Code Canary

**Catch Claude Code regressions before they catch you.**

Claude Code Canary is an open-source regression harness for Claude Code. It runs the same coding scenario in isolated Git worktrees, records deterministic outcomes and agent metrics, and compares Claude Code binaries/configurations side by side.

> Status: **early MVP / v0.1 development**. The core runner is usable, but interfaces may still change.

## Why Canary?

Claude Code changes quickly. So do your `CLAUDE.md`, hooks, plugins, MCP servers, skills and permission rules. When behavior changes, it is hard to answer:

- Did the Claude Code update cause the regression?
- Is the new `CLAUDE.md` actually better?
- Did a hook stop firing?
- Did token/tool usage jump?
- Which version first became bad?

Canary turns those questions into repeatable tests.

## What works in the MVP

- `cc-canary init` — create a scenario file
- `cc-canary validate` — validate YAML before spending tokens
- `cc-canary run` — run one scenario in a disposable Git worktree
- `cc-canary compare` — run the same scenario against two Claude executables
- `cc-canary bisect` — binary-search an ordered list of Claude executables/wrappers for the first bad one
- `cc-canary doctor` — check Git, Claude and repository readiness
- deterministic verification commands
- changed-file allow/deny rules
- expected/forbidden file assertions
- max tool-call / token / cost limits
- `stream-json` capture with tool-use and usage metrics
- JSON result artifacts for CI and later analysis

## Quick start

Requirements:

- Node.js 20+
- Git
- Claude Code installed and authenticated
- a Git repository to test

```bash
npm install
npm run build
npm link

cd /path/to/project
cc-canary init
cc-canary run .canary/basic.canary.yml
```

Canary deliberately uses Claude Code's documented non-interactive CLI (`claude -p`) and `stream-json` output instead of scraping the interactive terminal UI.

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

limits:
  max_tool_calls: 100
  max_total_tokens: 200000
  max_cost_usd: 5
```

A scenario passes only when Claude exits successfully **and** every deterministic assertion passes.

## Compare two Claude Code builds

Point Canary at two executables or wrapper scripts:

```bash
cc-canary compare .canary/basic.canary.yml \
  --baseline /opt/claude/2.1.220/claude \
  --candidate /opt/claude/2.1.237/claude
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

The MVP accepts executable paths instead of downloading historical Claude versions itself. A safe, cross-platform version manager is planned next.

## Find the first bad build

If you already have ordered Claude executables/wrappers:

```bash
cc-canary bisect .canary/basic.canary.yml --commands \
  ./claude-2.1.220 \
  ./claude-2.1.223 \
  ./claude-2.1.227 \
  ./claude-2.1.237
```

Canary verifies the first command is good and the last is bad, then binary-searches the range.

## Safety model

Canary isolates **files**, not your whole machine. Each run uses a disposable detached Git worktree, but commands executed by Claude or scenario setup/verification still run with your OS account permissions.

For untrusted repositories or aggressive permission settings, run Canary inside a container/VM. Canary defaults to conservative behavior and never enables `bypassPermissions` for you.

## Result artifacts

Each run writes a JSON result under:

```text
.canary/results/<timestamp>-<scenario>.json
```

The artifact contains:

- pass/fail and assertion failures
- Claude exit status
- changed files
- verification command results
- duration
- tool-call count
- token usage when reported by Claude Code
- cost when reported by Claude Code
- captured hook event names when present

Raw model text is not copied into the summary artifact by default.

## Roadmap

The direction is intentionally bigger than a simple test runner:

1. **v0.1 — deterministic harness**: run, compare, bisect, metrics, CI
2. **v0.2 — version manager**: install/cache historical Claude Code builds safely
3. **v0.3 — config experiments**: A/B test `CLAUDE.md`, settings, hooks, plugins and MCP configs
4. **v0.4 — record/replay**: turn a real Claude task into a reusable regression scenario
5. **v0.5 — repro bundles**: export a minimal redacted bug reproduction
6. **v0.6 — plugin compatibility matrix** and GitHub badge/action
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
