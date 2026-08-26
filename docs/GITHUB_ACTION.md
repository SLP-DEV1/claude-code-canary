# Claude Canary GitHub Action

Claude Canary can run the same deterministic scenario against a known-good Claude Code release and a candidate release directly in GitHub Actions.

## Quick start

1. Add a Canary scenario such as `.canary/basic.canary.yml` to your repository.
2. Add `ANTHROPIC_API_KEY` as a GitHub Actions repository secret.
3. Create `.github/workflows/claude-canary.yml`:

```yaml
name: Claude Canary

on:
  pull_request:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  regression-check:
    runs-on: ubuntu-latest
    timeout-minutes: 30
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

Use an exact release you trust for `from`. The `to` input defaults to `latest`.

> `@main` is the development channel while the project is in early `0.x`. Stable major-version references such as `@v1` will be documented when that release line exists.

## Inputs

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `scenario` | no | `.canary/basic.canary.yml` | Scenario file in the checked-out repository |
| `from` | yes | — | Known-good Claude Code release: exact version, `stable`, or `latest` |
| `to` | no | `latest` | Candidate Claude Code release |
| `node-version` | no | `22` | Node.js used to build/run Canary |
| `upload-results` | no | `true` | Upload JSON result files as a workflow artifact |

## What the Action does

The Action:

- installs and builds Claude Canary inside the Action checkout
- downloads/authenticates the requested Claude Code releases through Canary's version manager
- executes the same scenario against baseline and candidate releases
- writes the comparison to the GitHub Actions Step Summary
- fails the workflow when the candidate fails the deterministic scenario
- uploads `.canary/results/*.json` as a workflow artifact by default

The calling repository must be checked out first. `fetch-depth: 0` is recommended because Canary creates detached Git worktrees from the repository state.

## Add a badge

When your workflow file is `.github/workflows/claude-canary.yml`, add this to your README and replace `OWNER/REPO`:

```md
[![Claude Canary](https://github.com/OWNER/REPO/actions/workflows/claude-canary.yml/badge.svg)](https://github.com/OWNER/REPO/actions/workflows/claude-canary.yml)
```

For a custom `Claude Canary` label via Shields.io:

```md
[![Claude Canary](https://img.shields.io/github/actions/workflow/status/OWNER/REPO/claude-canary.yml?branch=main&label=Claude%20Canary)](https://github.com/OWNER/REPO/actions/workflows/claude-canary.yml)
```

This makes Canary visible in every repository that uses it while keeping the badge tied to the real workflow status.

## Security and cost

Claude runs non-interactively with the permissions configured by your scenario and consumes Anthropic API usage. Store credentials only in GitHub Actions secrets; do not put API keys in the workflow or scenario file.

Canary isolates repository files with disposable Git worktrees, not the entire GitHub runner. Treat setup, verification, hooks, MCP servers and Claude-issued commands as code execution on the runner.
