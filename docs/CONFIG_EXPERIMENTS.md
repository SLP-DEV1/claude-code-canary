# Configuration experiments

Configuration experiments answer a simple question with repeatable runs: **does this Claude Code configuration actually perform better on my scenario?**

## Quick start

Create two variant directories:

```text
.canary/variants/
  current/
    CLAUDE.md
  candidate/
    CLAUDE.md
```

Then run:

```bash
claude-canary experiment .canary/basic.canary.yml \
  --baseline-config .canary/variants/current \
  --candidate-config .canary/variants/candidate \
  --runs 5
```

Each trial starts from the same Git commit in a fresh detached worktree. Canary interleaves the order of the variants across rounds to reduce systematic time/order bias.

## Variant directory layout

A variant is a directory containing only the Claude Code configuration surfaces you want that variant to own:

```text
candidate/
├── CLAUDE.md
├── CLAUDE.local.md
├── .mcp.json
├── .claude/
│   ├── CLAUDE.md
│   ├── settings.json
│   ├── settings.local.json
│   ├── rules/
│   │   └── testing.md
│   └── hooks/
│       └── check.sh
└── plugins/
    ├── formatter-plugin/
    └── reviewer-plugin.zip
```

All entries are optional.

Controlled project surfaces are treated as **complete variant state**, not patches. For example, if the source repository contains `CLAUDE.md` but a variant does not, that run starts without the project-root `CLAUDE.md`. The same applies to the controlled settings/rules/hooks/MCP surfaces below.

Canary controls:

- `CLAUDE.md`
- `CLAUDE.local.md`
- `.claude/CLAUDE.md`
- `.claude/settings.json`
- `.claude/settings.local.json`
- `.claude/rules/**`
- `.claude/hooks/**`
- `.mcp.json`
- local plugin directories or `.zip` files under `plugins/`

Project code and unrelated `.claude/` components such as existing skills and agents remain identical between variants.

## Isolation model

Experiment runs add these Claude Code controls automatically:

```text
--setting-sources project,local
--strict-mcp-config
--mcp-config <variant-or-empty-config>
CLAUDE_CODE_DISABLE_AUTO_MEMORY=1
```

This prevents normal user settings, user CLAUDE.md/rules and auto memory from becoming an uncontrolled A/B variable. Plugins in `plugins/` are copied to a temporary runtime directory and loaded explicitly with repeated `--plugin-dir` flags.

Canary rejects scenario `claude.args` that would override the experiment boundary, including `--settings`, `--setting-sources`, `--mcp-config`, `--strict-mcp-config`, `--plugin-dir`, `--plugin-url`, and `--bare`.

### What is not removable

Claude Code managed/organization policy is intentionally still active. Managed settings and managed CLAUDE.md are enforced outside normal user/project configuration and Claude Code does not provide a client flag to disable them.

On some installations, authentication and global Claude application state still live outside the setting-source mechanism. Canary does not copy credentials into variant directories or result artifacts.

## Changed-file assertions

Variant configuration must not look like work produced by the agent.

Before Claude starts, Canary records the expected state of every controlled config fixture. After the run:

- an unchanged variant `CLAUDE.md` is excluded from `changed_files`
- a source config file intentionally removed by the variant is excluded
- if Claude itself modifies a controlled fixture during the run, that file is reported as changed

This allows existing deterministic `changed_files.allow` / `deny` assertions to keep working during configuration experiments.

## Metrics

For each variant Canary reports:

- deterministic pass rate
- average tool calls
- average total tokens
- average cost when Claude reports cost for every run
- average wall-clock duration

It also reports candidate-minus-baseline deltas.

Example:

```text
Claude Code Canary — configuration experiment

Scenario: fix-auth-regression
Runs per variant: 5
Baseline: current
Candidate: candidate

Metric            baseline          candidate         delta
Pass rate         3/5 60.0%         5/5 100.0%         +40.0 pp
Avg tool calls    44.2              31.8              -12.4
Avg tokens        87,120            63,402            -23,718
Avg cost          $1.5200           $1.0800            -$0.4400
Avg duration      142.2s            111.9s            -30.3s
```

The command exits non-zero when the candidate pass rate is lower than the baseline pass rate. Efficiency differences alone are informational because a universally correct token/time threshold would be arbitrary.

## JSON output and artifacts

Use:

```bash
claude-canary experiment .canary/basic.canary.yml \
  --baseline-config .canary/variants/current \
  --candidate-config .canary/variants/candidate \
  --runs 5 \
  --json
```

An aggregate artifact is also written to:

```text
.canary/results/<timestamp>-<scenario>-experiment.json
```

The experiment artifact contains labels, pass/fail summaries and metrics. It does **not** copy variant file contents, environment values, API keys, MCP credentials, or raw Claude output.

Individual scenario runs continue to produce their normal Canary result artifacts.

## Hooks

Put hook definitions in `.claude/settings.json` or `.claude/settings.local.json` and any supporting hook scripts under `.claude/hooks/` so the complete hook variant is portable:

```text
candidate/
└── .claude/
    ├── settings.json
    └── hooks/
        └── lint-after-edit.sh
```

Use `include_hook_events: true` in the Canary scenario when you also want hook-event metrics captured.

## MCP

A variant can provide `.mcp.json`. Canary passes it explicitly with `--mcp-config` and enables `--strict-mcp-config` so unrelated MCP servers are not part of the test.

If the variant has no `.mcp.json`, Canary creates a temporary empty MCP configuration for that run.

## Plugins

Place local plugins under `plugins/`:

```text
candidate/plugins/my-plugin/
candidate/plugins/other-plugin.zip
```

Each direct child is copied to an ephemeral runtime directory and loaded with its own `--plugin-dir` flag. Canary never writes plugin cache state into the variant source directory.

## Nondeterminism

Repeated runs reduce noise but do not make an LLM deterministic. A candidate that wins 3/3 runs is stronger evidence than a one-off result, but it is not a statistical proof.

Use deterministic verification commands and filesystem assertions whenever possible, increase `--runs` for noisy scenarios, and treat small token/time deltas cautiously.
