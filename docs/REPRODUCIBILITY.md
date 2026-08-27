# Reproducibility in v1

Claude Code Canary aims to make regressions repeatable without pretending that an agent run is perfectly deterministic.

## What Canary holds constant

For a normal scenario run, Canary fixes or records:

- the Git starting commit;
- the scenario YAML;
- the selected Claude executable/release;
- setup and verification commands;
- changed-file and filesystem/content assertions;
- model/permission/turn/budget settings supplied by the scenario;
- the repository starting state through a detached worktree.

Release comparisons run the same scenario from the same repository commit. Plugin matrices and plugin suites also inject a fresh copy of the same plugin source for each run.

Recorded scenarios retain the exact original starting commit so replay can reconstruct the same tracked source baseline later.

## What remains nondeterministic

Canary cannot eliminate variance caused by:

- model sampling and server-side model changes;
- network services and MCP servers;
- wall-clock time and external APIs;
- package registries or setup commands that do not pin dependencies;
- rate limits and transient service failures;
- machine performance and operating-system scheduling;
- user/managed Claude Code policy that the runtime does not allow Canary to override;
- external files or services intentionally referenced by the scenario.

A single pass/fail is therefore strongest when the assertions are deterministic and the task has low behavioral variance.

## Reducing noise

Prefer:

1. deterministic verification commands over prose-only success criteria;
2. exact dependency versions/lockfiles in the tested project;
3. local fixtures over live network data;
4. explicit model and permission settings where appropriate;
5. repeated configuration experiments when comparing probabilistic behavior;
6. a stable known-good/known-bad scenario before trusting binary-search output.

## Bisection assumption

Release bisection assumes a monotonic transition similar to `git bisect`: releases before a boundary are good and releases from the boundary onward are bad.

If a scenario is flaky, or a regression disappears and reappears across releases, binary search can identify a misleading boundary. Stabilize the scenario or repeat candidate releases before drawing a conclusion.

## Plugin suite interpretation

A release is "compatible" in a plugin suite only in the precise sense that every included smoke scenario passed on that release.

Generated scenarios are intentionally editable scaffolds. A green generated suite does not prove untested plugin semantics. Add custom deterministic scenarios for contracts that matter to your users.

## Stable v1 contracts

Claude Code Canary v1 freezes:

- scenario `version: 1` semantics documented by `schemas/canary.schema.json`;
- core run result `schemaVersion: 1` documented by `schemas/run-result.schema.json`;
- the public package entry point exported from `claude-code-canary`;
- documented CLI command names and GitHub Action mode names.

Future incompatible schema changes must use a new explicit schema version. v1 artifacts will not be silently reinterpreted as a different schema.

## Artifact provenance

Run artifacts include the resolved Git commit, scenario name, metrics, assertion failures and creation time. Plugin matrix/suite and experiment artifacts aggregate underlying runs without replacing their individual debugging artifacts.

Canary does not store raw environment-variable values in core result artifacts.
