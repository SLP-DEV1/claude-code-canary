# Claude Canary GitHub Action

Claude Canary exposes one composite Action for deterministic release comparisons, pull-request regression gates, MCP contract checks, committed-baseline checks and plugin compatibility suites.

Supported modes:

- `compare`
- `run`
- `pr-check`
- `baseline-check`
- `mcp-check`
- `plugin-matrix`
- `plugin-suite`

The Action streams Canary output into the job log, writes a GitHub Step Summary and uploads `.canary/results/` by default. Modes that produce Markdown reports (`pr-check`, `baseline-check`, `plugin-matrix`, `plugin-suite`) place that report directly in the Step Summary.

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

      - uses: SLP-DEV1/claude-code-canary@v1
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
- uses: SLP-DEV1/claude-code-canary@v1
  with:
    mode: baseline-check
    scenario: .canary/basic.canary.yml
```

A custom snapshot can be selected with `baseline:`. Baseline checks execute Claude only once and apply the same `regressions` thresholds against stored known-good metrics. The snapshot includes a SHA-256 of the scenario YAML, so changing the scenario without refreshing the baseline fails closed.

See [Committed baselines](BASELINES.md).

## MCP contract gate

MCP contract checks do not require Claude or a model credential. They initialize the configured stdio MCP server directly and compare its exposed protocol surface with explicit expectations and, by default, a committed known-good snapshot.

```yaml
- uses: SLP-DEV1/claude-code-canary@v1
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

      - uses: SLP-DEV1/claude-code-canary@v1
        with:
          mode: plugin-suite
          plugin: ./my-plugin
          last: 10
```

For the current exact immutable v1 patch release use `@v1.1.0` instead of the moving `@v1` compatibility tag. New modes documented under `[Unreleased]` are available from `main` until the next tagged release.

## Compare two Claude Code releases

```yaml
- uses: SLP-DEV1/claude-code-canary@v1
  with:
    mode: compare
    scenario: .canary/basic.canary.yml
    from: 2.1.220
    to: latest
```

`compare` requires `from`; `to` defaults to `latest`.

## Run one scenario

```yaml
- uses: SLP-DEV1/claude-code-canary@v1
  with:
    mode: run
    scenario: .canary/basic.canary.yml
```

## Run one plugin scenario across releases

```yaml
- uses: SLP-DEV1/claude-code-canary@v1
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
| `mode` | `compare` | all | `compare`, `run`, `pr-check`, `baseline-check`, `mcp-check`, `plugin-matrix`, or `plugin-suite` |
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
| `suite` | auto | plugin-suite | Generated Canary plugin-suite directory |
| `versions` | — | plugin modes | Space/comma-separated exact `x.y.z` releases |
| `last` | `10` | plugin modes | Newest published releases to test |
| `platform` | host | plugin modes | Supported Claude Code platform id override |
| `max-runs` | `200` | plugin-suite | Safety budget for `scenarios × releases` |
| `fail-on-incompatible` | `true` | plugin modes | Set `false` for report-only historical matrices |
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

`pr-check`, `baseline-check`, `plugin-matrix` and `plugin-suite` create report artifacts. `mcp-check` writes its bounded Markdown contract report directly into the Step Summary through the Action runner. The Action discovers the newly generated report and places it in `$GITHUB_STEP_SUMMARY`.

For modes without a combined Markdown report, the Action adds a bounded excerpt of the live CLI output to the summary. Full progress remains in the job log.

Artifact upload uses a run-specific name by default so parallel/retried jobs do not collide.

## How command execution is built

The Action runner is `scripts/action-runner.mjs`. It validates Action inputs, builds an argument array and launches:

```text
node <action>/dist/index.js <args...>
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

See [`SECURITY_MODEL.md`](SECURITY_MODEL.md) for the complete v1 trust model.

## Cost controls

Claude runs can consume API usage. Keep deterministic scenarios small and use:

- committed baselines when a second live run is unnecessary;
- `claude.max_turns`;
- `claude.max_budget_usd` where supported;
- scenario `limits`;
- plugin-suite `max-runs`.

When a scenario configures `max_cost_usd` but Claude does not report cost, v1 fails closed rather than silently ignoring the limit.

## Badge

For a workflow named `.github/workflows/claude-canary.yml`:

```md
[![Claude Canary](https://github.com/OWNER/REPO/actions/workflows/claude-canary.yml/badge.svg)](https://github.com/OWNER/REPO/actions/workflows/claude-canary.yml)
```

## Marketplace release

The root `action.yml` contains Marketplace metadata, branding, inputs and outputs. Publishing the listing is performed from a tagged GitHub Release by enabling **Publish this Action to the GitHub Marketplace**.

See [`RELEASING.md`](RELEASING.md) for the exact v1 release/Marketplace checklist.
