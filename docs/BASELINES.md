# Committed baselines

A release or PR comparison normally executes Claude twice. Committed baselines let CI execute only the current candidate and compare its metrics against a reviewed known-good snapshot.

## Create or refresh a baseline

```bash
claude-canary baseline update .canary/basic.canary.yml
```

By default Canary writes:

```text
.canary/baselines/<scenario-name>.json
```

Commit that JSON alongside the scenario. Canary refuses to save a baseline from a failing run.

You can choose another path:

```bash
claude-canary baseline update .canary/auth.canary.yml \
  --output .canary/baselines/auth-linux.json
```

## Check a baseline

```bash
claude-canary baseline check .canary/basic.canary.yml
```

This performs one current Claude run, applies the scenario's normal assertions, then applies the same `regressions` thresholds used by `compare` and `pr-check` against the stored metrics.

A Markdown report is written under `.canary/results/`.

## Stale-baseline protection

Each snapshot stores the SHA-256 of the exact scenario YAML used to create it. `baseline check` fails before spending a candidate comparison result if the scenario has changed without a corresponding baseline refresh.

That prevents a subtle failure mode where thresholds/assertions are edited but an old metric snapshot silently remains the reference point.

A baseline records:

- schema version;
- scenario name and repository-relative source path;
- scenario SHA-256;
- source Git commit;
- executable metadata;
- duration and Canary run metrics.

It does **not** store a Claude transcript or raw permission-tool arguments.

The machine-readable contract is [`schemas/baseline.schema.json`](../schemas/baseline.schema.json).

## GitHub Action

```yaml
name: Claude Canary baseline

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  canary:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      - uses: SLP-DEV1/claude-code-canary@v1
        with:
          mode: baseline-check
          scenario: .canary/basic.canary.yml
```

For a custom snapshot:

```yaml
      - uses: SLP-DEV1/claude-code-canary@v1
        with:
          mode: baseline-check
          scenario: .canary/auth.canary.yml
          baseline: .canary/baselines/auth-linux.json
```

## When to use which comparison

| Workflow | Claude runs | Best for |
| --- | ---: | --- |
| `compare --from/--to` | 2 | Claude Code release regressions |
| `pr-check --base/--head` | 2 | repository/PR behavior regressions |
| `baseline check` | 1 | cheap recurring CI against a reviewed known-good metric snapshot |

Baselines reduce model usage, but they can become intentionally obsolete as a project evolves. Review baseline JSON changes like test snapshots: a large token/cost/permission jump should have a reason, not just an automatic refresh.
