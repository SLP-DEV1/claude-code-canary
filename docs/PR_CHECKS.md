# Pull request regression checks

`claude-canary pr-check` runs the same Canary scenario against two Git refs with the **same Claude executable** and turns the comparison into a Markdown/JSON regression report.

This answers a different question from release `compare`:

- `compare`: did a Claude Code release change behavior?
- `pr-check`: did this repository change make the same Claude workflow worse?

## Local usage

```bash
claude-canary pr-check .canary/basic.canary.yml \
  --base origin/main \
  --head HEAD
```

Both refs run in disposable detached worktrees. The candidate fails when its standalone assertions fail or when configured `regressions` thresholds are exceeded.

A report can flag a PR even when the final task still succeeds:

```text
Functional          PASS -> PASS
Total tokens        48,120 -> 63,441   +31.8%  REGRESSION
Tool calls               8 -> 11       +37.5%  REGRESSION
Permission prompts       0 -> 1                 REGRESSION
Hook sequence        unchanged
```

The generated Markdown report is written under `.canary/results/` and the JSON CLI form includes both complete run results plus the regression evaluation.

## GitHub Action

For trusted/internal pull requests:

```yaml
name: Claude Canary PR

on:
  pull_request:

permissions:
  contents: read
  pull-requests: write # only required for comment-pr

jobs:
  canary:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      - uses: SLP-DEV1/claude-code-canary@v1
        with:
          mode: pr-check
          scenario: .canary/basic.canary.yml
          comment-pr: true
```

When `base-ref` / `head-ref` are blank, the Action reads the exact base/head SHAs from the `pull_request` event. If an exact SHA is missing from a shallow checkout, Canary fetches only that commit from `origin` before running the CLI.

`comment-pr: true` is opt-in. Canary uses one stable hidden marker and updates the existing report comment on reruns rather than creating a new comment for every push. Comment failures are best-effort so a missing write permission does not hide the actual regression result.

## Security

A Canary scenario can execute setup/verification commands and can direct Claude to use tools. Treat it as code.

Do **not** combine untrusted fork code with secrets. In particular, do not use `pull_request_target` to check out an untrusted PR head while exposing repository credentials or model/API keys. Fork `pull_request` tokens may also be read-only, in which case `comment-pr` logs a warning and the regression check itself still runs if it has the authentication it needs.

For untrusted contributions, prefer a maintainer-approved workflow, a sandboxed provider/account, or run Canary after the code has moved to a trusted branch.

## Recommended scenario thresholds

```yaml
regressions:
  max_total_tokens_increase_pct: 25
  max_input_tokens_increase_pct: 25
  max_output_tokens_increase_pct: 30
  max_reported_cost_increase_pct: 20
  max_tool_calls_increase_pct: 25
  max_permission_prompts_increase: 0
  max_permission_denied_increase: 0
  require_same_hook_sequence: true
```

Choose thresholds from real project variance rather than copying these numbers blindly. Model/gateway nondeterminism can make extremely tight budgets noisy.
