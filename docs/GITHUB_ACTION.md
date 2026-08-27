# Claude Canary GitHub Action

Claude Canary v1 exposes one composite Action for deterministic release comparisons and plugin compatibility gates.

Supported modes:

- `compare`
- `run`
- `plugin-matrix`
- `plugin-suite`

The Action streams Canary output into the job log, writes a useful GitHub Step Summary and uploads `.canary/results/` by default.

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
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0

      - uses: SLP-DEV1/claude-code-canary@v1
        with:
          mode: plugin-suite
          plugin: ./my-plugin
          last: 10
```

For an exact, immutable Action release use `@v1.0.0` instead of the moving `@v1` compatibility tag.

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
| `mode` | `compare` | all | `compare`, `run`, `plugin-matrix`, or `plugin-suite` |
| `scenario` | mode-specific | compare/run/matrix | Scenario path |
| `from` | — | compare/plugin modes | Baseline for compare, or oldest exact release in plugin range mode |
| `to` | compare: `latest` | compare/plugin modes | Candidate for compare, or newest exact release in plugin range mode |
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

`plugin-matrix` and `plugin-suite` already produce Markdown reports. The Action discovers the newly generated report and places it in `$GITHUB_STEP_SUMMARY`.

For modes without a combined Markdown report, the Action adds a bounded excerpt of the live CLI output to the summary. Full progress remains in the job log.

Artifact upload uses a run-specific name by default so parallel/retried jobs do not collide.

## How command execution is built

The Action runner is `scripts/action-runner.mjs`. It validates Action inputs, builds an argument array and launches:

```text
node <action>/dist/index.js <args...>
```

with `shell: false`.

Paths or version selectors supplied through Action inputs are not concatenated into a shell command string. The only shell layer in the composite Action launches the fixed Node runner path.

## Security

### Treat scenarios as code

A Canary scenario can contain setup/verification shell commands and Claude permission options. A configuration experiment can include hooks/MCP/plugin configuration. These are trusted inputs, not sandboxed data.

### Do not hand secrets to untrusted forks

Never combine privileged credentials with arbitrary fork code/scenarios. Safe defaults include:

- `workflow_dispatch`;
- trusted branch `push` events;
- PR workflows where secrets are intentionally unavailable to forks.

Be especially careful with `pull_request_target`: it runs with privileges from the base repository. Do not use it to check out and execute arbitrary untrusted fork contents with secrets.

### Worktree isolation is not OS isolation

Canary protects the checked-out Git source through disposable worktrees. Commands still execute as the GitHub runner user and can access resources available to that runner.

See [`SECURITY_MODEL.md`](SECURITY_MODEL.md) for the complete v1 trust model.

## Cost controls

Claude runs can consume API usage. Keep deterministic scenarios small and use:

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
