# Live Claude Code E2E

Unit tests and CLI smoke tests are necessary, but they cannot detect upstream Claude Code CLI contract changes. The live E2E suite runs Claude Canary against a real current Claude Code executable in a disposable Git repository.

## What it covers

`core` is intended for scheduled compatibility monitoring and exercises:

- Claude Code discovery/version reporting
- `doctor`
- `init` and `validate`
- `versions install latest` and `versions list`
- a real isolated `run` that must create exactly one expected file
- `compare` with two real Claude executions
- `plugin-init`

`full` includes everything in `core` and adds:

- `experiment` with one run per variant
- executable `bisect` with a real known-good Claude endpoint and an intentionally invalid known-bad endpoint
- `record`, a real Claude task, `save`, and `replay`
- `repro` from the intentionally failed bisect artifact
- `plugin-matrix` against the newest published Claude Code release
- `plugin-suite` against the newest published Claude Code release
- a self-test of the repository's composite GitHub Action in `run` mode

The generated fixture is deliberately tiny. Write-capable scenarios use `bypassPermissions` only inside the disposable fixture and assert that Claude changes exactly the requested file. Generated plugin tests remain read-only.

## Run locally

Requirements:

- Node.js 20+
- Git
- a working authenticated `claude` executable
- network access for `versions install latest` and the plugin release tests

Build Canary first:

```bash
npm ci --ignore-scripts
npm run build
```

Run the scheduled-size suite:

```bash
node scripts/live-e2e.mjs core
```

Run the broader manual suite:

```bash
node scripts/live-e2e.mjs full
```

Useful environment variables:

- `CLAUDE_CANARY_E2E_CLAUDE`: alternate Claude executable or command name
- `CLAUDE_CANARY_E2E_MODEL`: optional model override written into the live scenario
- `CLAUDE_CANARY_E2E_DIR`: explicit parent directory for the disposable fixture
- `CLAUDE_CANARY_E2E_KEEP=1`: retain the fixture after a successful run

A failed run always retains the fixture path in its output for inspection.

## GitHub Actions

`.github/workflows/live-e2e.yml` supports manual `core` and `full` runs. It also schedules `core` once per day.

Authentication is read only from repository Actions secrets. Configure one of:

- `ANTHROPIC_API_KEY`
- `CLAUDE_CODE_OAUTH_TOKEN`

For Pro/Max OAuth use, generate the token with `claude setup-token` on a trusted local machine and store only the resulting token as the repository secret.

If neither secret exists, the scheduled workflow records a clear skip notice instead of attempting Claude access. No secret value is printed.

The workflow installs Claude Code using Anthropic's current recommended Linux installer, builds the checked-out Canary commit, preserves live result artifacts, and writes the Claude version plus run mode into the GitHub Step Summary.

## Cost and safety

The `core` suite intentionally stays small, but it still performs real Claude calls. The `full` suite performs more calls and should normally be run manually before a release or after a compatibility-sensitive change.

Do not enable this workflow on untrusted fork-controlled scenarios with credentials. The committed workflow creates its own fixture and does not execute scenario content supplied by pull request authors.
