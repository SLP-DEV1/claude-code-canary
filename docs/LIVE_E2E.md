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

## Free-provider GitHub Actions path

The repository's scheduled/manual workflow does **not** require an Anthropic subscription or Anthropic API key. It keeps the real Claude Code CLI but routes its model traffic through a small headless Anthropic-to-OpenAI compatibility proxy.

Provider order:

1. **Groq** using `openai/gpt-oss-120b`
2. **OpenRouter** using `openrouter/free` only when Groq reports a recognizable rate/quota limit

The workflow intentionally does not retry ordinary Canary failures through OpenRouter. A broken assertion, Claude CLI incompatibility, plugin failure, malformed stream, or other non-rate-limit failure remains red. This prevents fallback from hiding real regressions.

Groq is treated as the primary provider because `openai/gpt-oss-120b` supports tool use and has a large enough output allowance for current Claude Code headless requests. The Groq free tier can still be too small for Claude Code's large prompt/token footprint, so recognized rate/quota failures are expected to fall back rather than being mistaken for Canary regressions. OpenRouter's free-model router may select different free models over time, so a fallback run is useful for transport/CLI compatibility but is less model-deterministic than the Groq primary route.

The headless proxy is `claude-code-agent-sdk-router`, pinned in the workflow to commit `47e06284af53a6bef86bba0f411977b92db82440`. The workflow checks out that exact commit, installs dependencies with lifecycle scripts disabled, builds it, and uses only local `127.0.0.1` proxy traffic between Claude Code and the router.

Provider keys are referenced from environment variables. Generated router config files contain `$GROQ_API_KEY` or `$OPENROUTER_API_KEY`, never the secret value itself.

## Run locally with an already working Claude setup

Requirements:

- Node.js 20+
- Git
- a working `claude` executable
- network access for `versions install latest` and the plugin release tests

Build Canary first:

```bash
npm ci --ignore-scripts
npm run build
```

If your local Claude Code is already authenticated or already routed through a compatible local gateway, run:

```bash
node scripts/live-e2e.mjs core
node scripts/live-e2e.mjs full
```

Useful environment variables:

- `CLAUDE_CANARY_E2E_CLAUDE`: alternate Claude executable or command name
- `CLAUDE_CANARY_E2E_MODEL`: optional model override written into the live scenario
- `CLAUDE_CANARY_E2E_DIR`: explicit parent directory for the disposable fixture
- `CLAUDE_CANARY_E2E_KEEP=1`: retain the fixture after a successful run

A failed run always retains the fixture path in its output for inspection.

## Run locally with Groq/OpenRouter

The provider wrapper expects a built `ccasr` CLI through `CLAUDE_CANARY_CCASR_CLI`. Configure at least one provider key:

```bash
export GROQ_API_KEY=...
export OPENROUTER_API_KEY=...   # optional fallback
export CLAUDE_CANARY_CCASR_CLI=/path/to/claude-code-agent-sdk-router/dist/cli.js
node scripts/live-provider-e2e.mjs run core
```

Optional model overrides:

- `CLAUDE_CANARY_GROQ_MODEL` defaults to `openai/gpt-oss-120b`
- `CLAUDE_CANARY_OPENROUTER_MODEL` defaults to `openrouter/free`
- `CLAUDE_CANARY_PROVIDER_PORT` defaults to `3456`

If only `OPENROUTER_API_KEY` exists, the wrapper starts directly on OpenRouter. If both exist, Groq is always attempted first.

## GitHub Actions

`.github/workflows/live-e2e.yml` supports manual `core` and `full` runs and schedules `core` once per day.

Configure repository Actions secrets:

- `GROQ_API_KEY` — recommended primary
- `OPENROUTER_API_KEY` — recommended fallback

At least one is required for a manual run. With both configured, Groq is primary and OpenRouter is used only after a detected Groq `429`/rate/quota limit. If neither secret exists, a scheduled run records a clear skip notice instead of attempting model access. A **manual** run without provider authentication fails deliberately so a skipped manual run can never be mistaken for release evidence. No secret value is printed.

Manual runs have an explicit run name:

```text
Live Claude E2E (core)
Live Claude E2E (full)
```

The `full` form is part of the v1.x release contract. `.github/workflows/release.yml` queries GitHub Actions before publication and requires a successful `Live Claude E2E (full)` run whose `head_sha` exactly matches the immutable release commit. A successful full run on an older or newer commit does not satisfy the gate.

The workflow installs current Claude Code using Anthropic's Linux installer, builds the checked-out Canary commit, builds the pinned provider router, preserves live result/provider artifacts, and records the selected provider/model plus whether fallback was used in the GitHub Step Summary.

## Cost and safety

The `core` suite intentionally stays small, but provider free-tier limits still apply. `full` performs substantially more model/tool calls and should normally be run manually before a release or after a compatibility-sensitive change.

Do not enable this workflow on untrusted fork-controlled scenarios with credentials. The committed workflow creates its own fixture and does not execute scenario content supplied by pull request authors. The live provider workflow is scheduled/manual only and does not run on pull requests.
