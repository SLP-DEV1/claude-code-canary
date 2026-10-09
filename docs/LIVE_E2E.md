# Live Claude Code E2E

Unit tests and CLI smoke tests are necessary, but they cannot detect upstream Claude Code CLI contract changes. The live E2E suite runs Claude Canary against a real current Claude Code executable in a disposable Git repository.

## What it covers

`core` is intended for scheduled compatibility monitoring and exercises:

- Claude Code discovery/version reporting
- `doctor`
- `init` and `validate`
- `versions install latest` and `versions list`
- a real isolated read-only `run` that must read a repository-only seed marker and return it without changing files
- `compare` with two real Claude executions
- `plugin-init`

`full` includes everything in `core` and adds:

- `experiment` with one run per variant
- executable `bisect` with a real known-good Claude endpoint and an intentionally invalid known-bad endpoint
- `record`, a real Claude task, `save`, and `replay`
- `repro` from the intentionally failed bisect artifact
- fail-closed `plugin-suite` coverage that invokes the plugin compatibility matrix once per generated scenario against the pinned Claude Code release
- a self-test of the repository's composite GitHub Action in `run` mode

The generated fixture is deliberately tiny. The core `run`/`compare` scenario is read-only: the prompt does not contain the expected marker, so Claude must use the repository file-reading tool to read `seed.txt`, return the marker and leave the worktree unchanged. The full-suite record/replay check also keeps the Claude task read-only; after the initial real task, the harness resets any incidental workspace edits and creates one harness-owned marker that `save` records, while the generated setup command recreates that marker before `replay`. This exercises recording metadata, exact-start-state replay and verification without requiring two independent model runs to reproduce the same edit. Other write-capable full-suite scenarios use `bypassPermissions` only inside the disposable fixture and assert their requested changes. Generated plugin tests remain read-only. The live harness raises generated plugin scenarios from their normal 80,000-token guardrail to 200,000 tokens because current Claude Code system/tool context can legitimately exceed the normal smoke-test budget. This override is live-E2E-only and does not change the product default.

For plugin coverage, fail-closed `plugin-suite` invokes the same compatibility matrix implementation once per generated scenario. A real incompatibility still blocks the release without duplicating model calls for a second report-only pass. This is important for free-provider daily request limits.

## Free-provider GitHub Actions path

The repository's scheduled/manual workflow does **not** require an Anthropic subscription or Anthropic API key. It keeps the real Claude Code CLI but routes its model traffic through a small headless compatibility proxy.

Preferred provider path:

1. **Gemini** using `gemini-3.6-flash` when `GEMINI_API_KEY` is configured
2. **OpenRouter** using `openrouter/free` only if the previous provider fails with an attributable capacity/availability error
3. **Groq** using `openai/gpt-oss-120b` as a last-resort fallback, only when `GROQ_API_KEY` is configured and OpenRouter is also exhausted/unavailable

If a provider key is absent, that provider is skipped. If only Groq or OpenRouter is configured, the corresponding provider is tried directly. Every subsequent attempt starts the complete live suite with a fresh fixture. **Non-provider errors always fail closed and never trigger fallback.**

Gemini is preferred because Claude Code headless requests can contain tens of thousands of input tokens before the task begins. Groq Free has previously rejected such large requests under input-token-per-minute limits; its availability cannot be guaranteed. All free providers may exhaust daily/request limits. When all configured providers are unavailable, the workflow must fail and **must not publish**.

A failed provider selection stores only allowlisted provider names, HTTP status codes and outcome categories in `attempts.json` so diagnosis works even without `selected.json`. Provider error bodies, API keys and chat transcripts are never copied into this metadata.

The headless proxy is `claude-code-agent-sdk-router`, pinned in the workflow to commit `47e06284af53a6bef86bba0f411977b92db82440`. That exact router revision already supports Gemini, OpenRouter and Groq routes, including Gemini 3-style thinking levels. The workflow checks out that exact commit, installs dependencies with lifecycle scripts disabled, builds it, and uses only local `127.0.0.1` proxy traffic between Claude Code and the router.

Provider keys are referenced from environment variables. Generated router config files contain `$GEMINI_API_KEY`, `$GROQ_API_KEY` or `$OPENROUTER_API_KEY`, never the secret value itself.

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

## Run locally with free providers

The provider wrapper expects a built `ccasr` CLI through `CLAUDE_CANARY_CCASR_CLI`. Configure at least one provider key. Gemini plus OpenRouter fallback is the recommended hosted combination:

```bash
export GEMINI_API_KEY=...
export OPENROUTER_API_KEY=...   # optional capacity/availability fallback
export CLAUDE_CANARY_CCASR_CLI=/path/to/claude-code-agent-sdk-router/dist/cli.js
node scripts/live-provider-e2e.mjs run core
```

Groq remains supported for existing setups:

```bash
export GROQ_API_KEY=...
export OPENROUTER_API_KEY=...   # optional capacity fallback
node scripts/live-provider-e2e.mjs run core
```

Optional model overrides:

- `CLAUDE_CANARY_GEMINI_MODEL` defaults to `gemini-3.6-flash`
- `CLAUDE_CANARY_GROQ_MODEL` defaults to `openai/gpt-oss-120b`
- `CLAUDE_CANARY_OPENROUTER_MODEL` defaults to `openrouter/free`
- `CLAUDE_CANARY_PROVIDER_PORT` defaults to `3456`

When Gemini is configured it is preferred. Groq is only selected as the primary when Gemini is absent. OpenRouter is used directly when it is the only configured provider, or as the capacity/availability fallback from the selected primary.

## GitHub Actions

`.github/workflows/live-e2e.yml` supports manual `core` and `full` runs and schedules `core` once per day.

Configure repository Actions secrets:

- `GEMINI_API_KEY` — recommended primary
- `OPENROUTER_API_KEY` — recommended capacity/availability fallback
- `GROQ_API_KEY` — optional backward-compatible provider

At least one is required for a manual run. If no secret exists, a scheduled run records a clear skip notice instead of attempting model access. A **manual** run without provider authentication fails deliberately so a skipped manual run can never be mistaken for release evidence. No secret value is printed.

Manual runs have an explicit run name:

```text
Live Claude E2E (core)
Live Claude E2E (full)
```

The `full` form is part of the v2 release contract. `.github/workflows/release.yml` queries GitHub Actions before publication and requires a successful `Live Claude E2E (full)` run whose `head_sha` exactly matches the immutable release commit. A successful full run on an older or newer commit does not satisfy the gate.

The workflow installs current Claude Code using Anthropic's Linux installer, builds the checked-out Canary commit, builds the pinned provider router, preserves live result/provider artifacts, and records the primary provider, provider/model actually used and whether a capacity fallback was needed in the GitHub Step Summary.

## Cost and safety

The `core` suite intentionally stays small, but provider free-tier limits still apply. `full` performs substantially more model/tool calls and should normally be run manually before a release or after a compatibility-sensitive change.

Do not enable this workflow on untrusted fork-controlled scenarios with credentials. The committed workflow creates its own fixture and does not execute scenario content supplied by pull request authors. The live provider workflow is scheduled/manual only and does not run on pull requests.
