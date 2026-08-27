# Extension compatibility doctor

`claude-canary doctor` checks whether the local environment is ready to run Canary. In v1.2 it also exposes a machine-readable compatibility preflight for Claude Code extension surfaces.

```bash
claude-canary doctor
claude-canary doctor --json
claude-canary doctor --plugin ./my-plugin --json
```

The human report keeps the existing Node.js, Git, Claude Code and clean-tree checks. The JSON report uses `schemaVersion: 1` and adds structured compatibility metadata.

## What the JSON report includes

- Canary version
- Node.js version, platform and architecture
- whether stdin/stdout are attached to a real TTY
- whether the process appears to run in CI
- Claude Code availability, version and whether its executable came from `PATH` or an explicit path
- repository readiness and tracked-change count
- active provider **mode**, inferred only from the presence of known configuration variables
- boolean credential/configuration-presence indicators
- discovered plugin component types and counts
- plugin dependency names/version constraints/marketplace names
- LSP executable availability
- project `.mcp.json` transport counts
- stdio MCP executable availability
- whether the experimental agent-team flag is present
- compatibility warnings for ambiguous provider flags, no-TTY team runs and provider-sensitive experimental features

The schema is published as [`schemas/doctor-result.schema.json`](../schemas/doctor-result.schema.json).

## Privacy and secret handling

The doctor is intentionally value-blind for provider and credential configuration. It records **presence booleans and variable names only**. It does not emit:

- API keys or OAuth tokens
- AWS, Google or Azure credential values
- `ANTHROPIC_BASE_URL` values
- MCP URLs
- MCP headers
- MCP environment values
- plugin command environment values

For project MCP configuration, remote endpoints are reduced to transport type (`http`/`sse`) and server name. For stdio servers only the executable basename and an availability boolean are retained.

The doctor does not start LSP servers, monitors or MCP servers. External extension executables are path-checked only. The normal prerequisite checks still execute `git --version` and `<claude> --version`.

## Provider detection

Canary currently recognizes these environment indicators:

- `ANTHROPIC_BASE_URL` → custom compatible gateway
- `CLAUDE_CODE_USE_BEDROCK`
- `CLAUDE_CODE_USE_VERTEX`
- `CLAUDE_CODE_USE_FOUNDRY`
- `CLAUDE_CODE_USE_MANTLE`

If more than one cloud-provider flag is present, the preflight fails with `provider.multiple-flags`. A flag that is present with a false-looking value also produces a warning because Claude Code provider selectors are presence-sensitive in current official integrations. Remove a provider variable when disabling that provider rather than leaving it set to a false-looking string.

Provider detection does not prove authentication or network reachability. It only reports the non-secret configuration shape that Canary can safely inspect locally.

## Plugins

Pass one or more plugin directories explicitly:

```bash
claude-canary doctor --plugin ./plugins/foo ./plugins/bar --json
```

If no `--plugin` is given and the current directory itself contains `.claude-plugin/plugin.json`, Canary inspects that plugin automatically.

Plugin discovery reuses the same validation as `plugin-init`. The doctor reports commands, agents, skills, hooks, MCP declarations, LSP servers, monitors and plugin dependencies. LSP command binaries are checked without launching them.

A missing required LSP executable fails the preflight because the generated LSP compatibility scenario could not run successfully on that host.

## Project MCP configuration

When a project contains `.mcp.json`, Canary reads only the bounded configuration structure needed to identify server names, transports and stdio commands. The file is capped at 1 MiB for the preflight.

Supported transport classifications are:

- `stdio`
- `http` / `streamable-http`
- `sse`
- `unknown`

A missing stdio command executable fails the preflight. Remote HTTP/SSE endpoints are not contacted.

## Agent teams

Agent teams remain an experimental upstream surface. If `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` is present, the doctor reports that the feature is configured.

`team-run` requires a real interactive TTY. Therefore a configured team environment in normal non-interactive CI produces a warning rather than pretending team behavior can be validated there. A non-first-party provider also produces a compatibility warning because experimental feature availability can differ by host/provider.

## Exit status

`doctor` exits non-zero when any hard prerequisite or compatibility check fails, including examples such as:

- unsupported Node.js version
- Git or Claude Code unavailable
- tracked repository changes when a reproducible run requires a clean tree
- invalid plugin discovery
- missing LSP executable
- malformed project MCP configuration
- missing stdio MCP executable
- conflicting provider-mode flags

Warnings alone do not make the report fail.
