# Security and trust model

Claude Code Canary executes coding-agent workloads. That makes its trust boundaries more important than those of a passive test reporter.

This document describes the v1 security model. For private vulnerability reporting and supported versions, see [`../SECURITY.md`](../SECURITY.md).

## Trust boundaries

### Trusted inputs

Treat these as executable or security-sensitive code:

- Canary scenario YAML;
- `setup.commands` and `verify.commands`;
- `claude.args`, permission modes and environment values;
- configuration experiment variants;
- Claude Code plugins being deliberately tested;
- GitHub workflow definitions that provide credentials to Canary.

A scenario can intentionally execute shell commands. Canary is not a sandbox for hostile scenario files.

### Untrusted outputs

Claude/model output, tool results, downloaded release bytes before verification, plugin behavior under test and generated result data are treated as untrusted observations.

Canary does not execute Claude stdout as shell code. Headless output is parsed as `stream-json`; malformed non-empty protocol lines fail the run in v1.

## Worktree isolation

Ordinary runs require a clean tracked source checkout and resolve a concrete Git commit before execution. The scenario runs in a disposable detached Git worktree rather than in the user's checkout.

The worktree is removed after the run even when execution throws. If worktree creation itself fails, v1 also removes the temporary parent directory.

Isolation protects the source checkout from normal tested edits; it is not an operating-system sandbox. A process launched by a scenario still has the permissions of the current OS user.

## Process execution

Canary invokes Claude and Git with argument arrays and `shell: false`. Shell execution is used only for explicit user-authored setup/verification commands.

Subprocess capture is bounded. If Claude exceeds the capture limit, Canary kills the process and fails closed instead of evaluating incomplete protocol data.

## Release downloads

Historical Claude Code binaries are stored in Canary's own cache. Canary never replaces the user's normal Claude executable.

The version manager:

1. resolves an exact release;
2. fetches the official release manifest;
3. verifies a detached manifest signature when the release carries Anthropic's signed-manifest format supported by Canary;
4. validates the requested platform against a fixed allow-list;
5. bounds manifest and binary downloads;
6. verifies SHA-256 and published size before accepting a binary;
7. re-verifies cached binaries before reuse.

Platform override strings are not used as arbitrary path fragments.

## Plugin and configuration isolation

Plugin compatibility runs copy the plugin to a fresh temporary runtime directory for each underlying run. Plugin trees containing symbolic links are rejected.

Generated plugin suites must carry Canary's marker, must match current discovery metadata and must contain every expected generated component scenario. This prevents stale or accidentally incomplete suites from producing a false green result.

Configuration experiment variants are validated before token-spending runs. v1 rejects symbolic links anywhere in a variant tree so a controlled configuration cannot silently point outside the fixture.

## Reproduction bundles

Reproduction export is designed for review, not blind publication.

Canary:

- selects bounded fixture roots from deterministic scenario scope;
- denies common credential, dependency, cache and build paths;
- refuses symbolic links and binary files;
- enforces per-file, file-count and total-size bounds;
- redacts common secret-like strings and machine-specific absolute paths;
- strips environment values and raw model transcripts;
- refuses `--force` deletion unless the destination carries Canary's repro marker.

No generic redactor can understand project-specific confidential information. Always inspect a generated bundle before publishing it.

## CI and GitHub Actions

The v1 composite Action converts inputs into a direct CLI argument array; user inputs are not interpolated into the shell command that launches Canary.

Third-party Actions used by this repository are pinned to immutable commit SHAs. CI runs on Linux, Windows and macOS, while CodeQL scans JavaScript/TypeScript changes.

### Secrets and pull requests

Do not expose `ANTHROPIC_API_KEY`, cloud credentials or other secrets to untrusted fork code or untrusted Canary scenarios.

A safe default is to run secret-backed Canary jobs on trusted branches or manual `workflow_dispatch` events. If you design PR automation, understand GitHub's fork-secret behavior and the risks of `pull_request_target`. Never combine privileged credentials with checking out and executing arbitrary untrusted fork code.

## Permission modes

Canary exposes Claude Code permission-mode configuration because testing real configurations is part of its purpose. A permissive mode does not become safe merely because the run occurs in a detached Git worktree.

Use the least permissive mode compatible with the scenario and isolate CI credentials accordingly.

## Denial of service and cost

Agent runs can consume tokens, time and tool calls. Canary provides scenario limits and plugin-suite run budgets. Cost limits fail closed when a cost metric is configured but Claude does not report a measurable cost value.

The plugin-suite default run budget limits accidental `scenarios × releases` explosions; increasing it should be an explicit decision.

## Out of scope

Canary does not claim to provide:

- a kernel/container sandbox;
- protection from a malicious OS user;
- safe execution of hostile scenario YAML;
- perfect secret detection/redaction;
- proof that a passing smoke scenario covers every semantic behavior of a plugin;
- cryptographic authenticity for historical release metadata that predates the signed-manifest mechanism Canary can verify.

Those limitations are intentional and documented so a green Canary result is not confused with a stronger security claim.
