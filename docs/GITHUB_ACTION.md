# Claude Canary GitHub Action

Claude Canary exposes one composite Action for deterministic release comparisons, pull-request regression gates, MCP contract checks, committed-baseline checks, plugin compatibility suites, first-class scenario suites and release watching.

Supported modes:

- `compare`
- `run`
- `pr-check`
- `baseline-check`
- `mcp-check`
- `plugin-matrix`
- `plugin-suite`
- `suite`
- `watch`

The Action streams Canary output into the job log, writes a GitHub Step Summary and uploads `.canary/results/` by default. Modes that produce combined reports (`pr-check`, `baseline-check`, `plugin-matrix`, `plugin-suite`, `suite`, `watch`) place that report directly in the Step Summary.

## Pull-request regression gate

For trusted/internal pull requests:

```yaml
name: Claude Canary PR

on:
  pull_request:

permissions:
  contents: read
  pull-requests: write # only needed for comment-pr

jobs:
  canary:
    runs-on: ubuntu-latest
    env:
      ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
    steps:
      - uses: actions/checkout@v7

      - uses: SLP-DEV1/claude-code-canary@v2
        with:
          mode: pr-check
          scenario: .canary/basic.canary.yml
          comment-pr: true
```

When `base-ref` / `head-ref` are blank, Canary reads the exact base/head SHAs from the `pull_request` event. If one of those commits is absent from a shallow checkout, the Action fetches only that exact SHA before executing the check.

`pr-check` uses the same Claude executable for both Git refs. It is intended to detect repository changes that preserve the final output but regress configured token, reported-cost, tool-call, permission or hook-sequence thresholds.

`comment-pr` is opt-in. Canary writes one marker-owned bot comment and updates it on reruns rather than adding a new comment for every push. Comment writing is best-effort: a read-only fork token or missing `pull-requests: write` permission does not replace the underlying Canary result.

See [Pull request regression checks](PR_CHECKS.md) for security and local usage.

## One-run CI with a committed baseline

First create and review a baseline locally:

```bash
claude-canary baseline update .canary/basic.canary.yml
```

Commit the generated `.canary/baselines/<scenario-name>.json`, then use:

```yaml
- uses: SLP-DEV1/claude-code-canary@v2
  with:
    mode: baseline-check
    scenario: .canary/basic.canary.yml
```

A custom snapshot can be selected with `baseline:`. Baseline checks execute Claude only once and apply the same `regressions` thresholds against stored known-good metrics. The snapshot includes a SHA-256 of the scenario YAML, so changing the scenario without refreshing the baseline fails closed.

See [Committed baselines](BASELINES.md).

## MCP contract gate

MCP contract checks do not require Claude or a model credential. They initialize the configured stdio MCP server directly and compare its exposed protocol surface with explicit expectations and, by default, a committed known-good snapshot.

```yaml
- uses: SLP-DEV1/claude-code-canary@v2
  with:
    mode: mcp-check
    mcp-contract: .canary/mcp/github.mcp.yml
    mcp-require-baseline: true
```

The optional shared `baseline` input selects a non-default MCP snapshot path in this mode. See [MCP contract testing](MCP_CONTRACTS.md).

## Plugin suite quick start

Commit a generated/reviewed plugin smoke suite to your repository, then create `.github/workflows/claude-canary.yml`:

```yaml
name: Claude Canary

on:
  workflow_dispatch:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  plugin-compatibility:
    runs-on: ubuntu-latest
    timeout-minutes: 45
    env:
      ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0

      - uses: SLP-DEV1/claude-code-canary@v2
        with:
          mode: plugin-suite
          plugin: ./my-plugin
          last: 10
```

For the immutable v2 launch release use `@v2.0.0` instead of the moving `@v2` compatibility tag. The v1 major channel remains on the v1.x line.

## Run a first-class scenario suite

```yaml
- uses: SLP-DEV1/claude-code-canary@v2
  with:
    mode: suite
    suite: .canary/release.suite.yml
    tag: release
    concurrency: 2
    max-runs: 100
```

Suites provide deterministic selection, bounded concurrency, sharding, run budgets, failure fingerprints, explainable selection and combined result artifacts. `reuse-results: true` reuses only compatibility-identical cached evidence.

For deterministic CI sharding:

```yaml
- uses: SLP-DEV1/claude-code-canary@v2
  with:
    mode: suite
    suite: .canary/release.suite.yml
    shard: 2/4
```

## Watch new Claude Code releases

```yaml
- uses: SLP-DEV1/claude-code-canary@v2
  with:
    mode: watch
    suite: .canary/release.suite.yml
    watch-good: 2.1.230
```

Run this mode from a trusted scheduled workflow. Canary stores small non-secret watch state, tests newly observed releases and can identify the first bad release when a regression appears. Use `check-only: true` to report unseen releases without launching Claude or mutating watch state.

## Compare two Claude Code releases

```yaml
- uses: SLP-DEV1/claude-code-canary@v2
  with:
    mode: compare
    scenario: .canary/basic.canary.yml
    from: 2.1.220
    to: latest
```

`compare` requires `from`; `to` defaults to `latest`.

## Run one scenario

```yaml
- uses: SLP-DEV1/claude-code-canary@v2
  with:
    mode: run
    scenario: .canary/basic.canary.yml
```

## Run one plugin scenario across releases

```yaml
- uses: SLP-DEV1/claude-code-canary@v2
  with:
    mode: plugin-matrix
    scenario: .canary/plugins/my-plugin/command-review.canary.yml
    plugin: ./my-plugin
    from: 2.1.220
    to: 2.1.237
```

You can use `versions` or `last` instead of `from`/`to`.

## Inputs

| Input | Default | Used by | Description |
| --- | --- | --- | --- |
| `mode` | `compare` | all | `compare`, `run`, `pr-check`, `baseline-check`, `mcp-check`, `plugin-matrix`, `plugin-suite`, `suite`, or `watch` |
| `scenario` | mode-specific | compare/run/pr-check/baseline-check/matrix | Scenario path |
| `from` | — | compare/plugin modes | Baseline release for compare, or oldest exact release in plugin range mode |
| `to` | compare: `latest` | compare/plugin modes | Candidate release for compare, or newest exact release in plugin range mode |
| `base-ref` | PR base SHA / `origin/main` | pr-check | Git ref for the baseline worktree |
| `head-ref` | PR head SHA / `HEAD` | pr-check | Git ref for the candidate worktree |
| `baseline` | generated default | baseline-check/mcp-check | Optional committed baseline JSON path |
| `mcp-contract` | `.canary/mcp/server.mcp.yml` | mcp-check | MCP contract YAML path |
| `mcp-require-baseline` | `true` | mcp-check | Fail when no reviewed MCP baseline exists |
| `comment-pr` | `false` | pr-check | Best-effort stable PR report comment; requires `pull-requests: write` |
| `plugin` | — | plugin modes | Plugin directory |
| `suite` | mode-specific | plugin-suite/suite/watch | Generated plugin-suite directory or first-class scenario-suite YAML |
| `versions` | — | plugin modes | Space/comma-separated exact `x.y.z` releases |
| `last` | `10` | plugin modes | Newest published releases to test |
| `platform` | host | plugin/watch | Supported Claude Code platform id override |
| `max-runs` | `200` | plugin-suite/suite/watch | Safety budget for scenario/release execution |
| `fail-on-incompatible` | `true` | plugin modes | Set `false` for report-only historical matrices |
| `tag` | — | suite/watch | Select only scenarios with this tag |
| `shard` | — | suite/watch | Deterministic `N/M` suite shard |
| `concurrency` | suite default | suite/watch | Maximum concurrent scenario runs |
| `reuse-results` | `false` | suite/watch | Reuse only compatibility-identical cached scenario results |
| `watch-state` | `.canary/watch-state.json` | watch | Non-secret release watcher state file |
| `watch-good` | — | watch | Initial exact known-good Claude Code release when bootstrapping |
| `check-only` | `false` | watch | Report unseen releases without launching Claude or mutating state |
| `node-version` | `22` | all | Node used to build/run Canary |
| `upload-results` | `true` | all | Upload `.canary/results/` after the run |
| `artifact-name` | generated | all | Optional artifact name override |
| `retention-days` | `14` | all | Artifact retention |

Version selectors for plugin modes are mutually exclusive in practice: use one of `versions`, `from` + `to`, or `last`. `versions` takes priority in Action argument construction.

## Outputs

| Output | Description |
| --- | --- |
| `results-path` | `.canary/results` directory used by the Action |
| `report-path` | Combined Markdown report when the mode creates one |
| `passed` | `true` when Canary exited successfully |
| `exit-code` | Canary CLI exit code |
| `artifact-name` | Unique default artifact name generated for the run |

## Step Summary and artifacts

`pr-check`, `baseline-check`, `plugin-matrix`, `plugin-suite`, `suite` and `watch` create report artifacts. `mcp-check` writes its bounded Markdown contract report directly into the Step Summary through the Action runner. The Action discovers the newly generated report and places it in `$GITHUB_STEP_SUMMARY`.

For modes without a combined Markdown report, the Action adds a bounded excerpt of the live CLI output to the summary. Full progress remains in the job log.

Artifact upload uses a run-specific name by default so parallel/retried jobs do not collide.

## How command execution is built

The Action runner is `scripts/action-runner.mjs`. It validates Action inputs, builds an argument array and launches:

```text
node <action>/dist/v2-cli.js <args...>
```

with `shell: false`.

Paths or version selectors supplied through Action inputs are not concatenated into a shell command string. The only shell layer in the composite Action launches fixed Node helper paths.

For `pr-check`, `scripts/ensure-pr-refs.mjs` fetches a missing ref only when it is an exact 40-character Git SHA. Arbitrary user-supplied text is not converted into a fetch ref by that helper.

## Security

### Treat scenarios as code

A Canary scenario can contain setup/verification shell commands and Claude permission options. A configuration experiment can include hooks/MCP/plugin configuration. These are trusted inputs, not sandboxed data.

### Do not hand secrets to untrusted forks

Never combine privileged credentials with arbitrary fork code/scenarios. Safe defaults include:

- `workflow_dispatch`;
- trusted branch `push` events;
- PR workflows where secrets are intentionally unavailable to forks;
- maintainer-approved/sandboxed model credentials for untrusted contributions.

Be especially careful with `pull_request_target`: it runs with privileges from the base repository. Do not use it to check out and execute arbitrary untrusted fork contents with secrets.

A normal fork `pull_request` may receive a read-only `GITHUB_TOKEN`; `comment-pr` then warns and leaves the regression check/result intact.

### Worktree isolation is not OS isolation

Canary protects the checked-out Git source through disposable worktrees. Commands still execute as the GitHub runner user and can access resources available to that runner.

See [`SECURITY_MODEL.md`](SECURITY_MODEL.md) for the complete trust model.

## Cost controls

Claude runs can consume API usage. Keep deterministic scenarios small and use:

- committed baselines when a second live run is unnecessary;
- `claude.max_turns`;
- `claude.max_budget_usd` where supported;
- scenario `limits`;
- `max-runs` for suite/plugin matrices;
- `check-only` for watch discovery when live execution is not wanted.

When a scenario configures `max_cost_usd` but Claude does not report cost, Canary fails closed rather than silently ignoring the limit.

## Badge

For a workflow named `.github/workflows/claude-canary.yml`:

```md
[![Claude Canary](https://github.com/OWNER/REPO/actions/workflows/claude-canary.yml/badge.svg)](https://github.com/OWNER/REPO/actions/workflows/claude-canary.yml)
```

## Marketplace release

The root `action.yml` contains Marketplace metadata, branding, inputs and outputs. Publishing the listing is performed from a tagged GitHub Release by enabling **Publish this Action to the GitHub Marketplace** when GitHub requires release-specific confirmation.

See [`RELEASING.md`](RELEASING.md) for the major-aware release/Marketplace contract.
