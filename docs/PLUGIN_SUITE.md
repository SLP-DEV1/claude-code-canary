# Plugin compatibility suites

`claude-canary plugin-suite` runs every Canary-generated plugin smoke scenario against the same Claude Code release set and produces one combined compatibility report.

The intended workflow is:

```bash
claude-canary plugin-init ./my-plugin
claude-canary plugin-suite --plugin ./my-plugin --last 10
```

`plugin-init` discovers the plugin surface and generates reviewable smoke scenarios. `plugin-suite` then executes the complete generated suite across the selected Claude Code releases.

## What gets tested

By default Canary reads the suite from:

```text
.canary/plugins/<plugin-name>/
```

Only directories carrying Canary's `.claude-canary-plugin-init` marker are accepted. The runner loads all `*.canary.yml` files and orders generated scenarios consistently:

1. plugin load
2. commands
3. agents
4. skills
5. hooks
6. MCP servers
7. LSP servers
8. any custom scenarios added to the generated directory

You can point at another Canary-generated suite directory with:

```bash
claude-canary plugin-suite \
  --plugin ./my-plugin \
  --suite .canary/custom-plugin-suite \
  --last 10
```

## Freshness and coverage guards

Before any Claude run starts, `plugin-suite` compares the suite's `discovery.json` with the plugin's current discovered surface. Commands, agents, skills, hooks, MCP servers and LSP servers are tracked. Monitor definitions and plugin dependency declarations are tracked too, including dependency version/marketplace constraints and the relevant LSP command/extensions. If any tracked surface changes after the suite was generated, Canary refuses the run instead of testing stale coverage.

Canary also verifies that every scenario expected from the current plugin surface is still present. Deleting `command-review.canary.yml`, for example, cannot silently make a failing command disappear from an otherwise green suite. Extra custom `*.canary.yml` scenarios are allowed and run after the generated component scenarios.

When either guard fails, regenerate the suite and review the resulting YAML again:

```bash
claude-canary plugin-init ./my-plugin --force
```

For a custom suite destination, regenerate to the same path with `--output` and pass that path back to `plugin-suite --suite`.

## LSP, monitors and plugin dependencies

Canary handles these surfaces according to how Claude Code exposes them:

- **LSP servers** are discovered from `.lsp.json` or `plugin.json#lspServers`, structurally validated, and receive generated release-matrix smoke scenarios. A missing external language-server executable or unavailable LSP registration is treated as a visible compatibility failure rather than a parser error.
- **Monitors** are discovered from `monitors/monitors.json` or `experimental.monitors` and validated as a static contract. Canary never starts monitor commands automatically. Claude Code monitors are background processes and can execute unsandboxed commands, so silently launching them from a compatibility scanner would be unsafe.
- **Plugin dependencies** are discovered from `plugin.json#dependencies` and tracked by name plus optional version and marketplace constraints. Canary treats declaration changes as stale-suite changes. Dependency installation/resolution itself remains Claude Code's responsibility during plugin loading.

Legacy top-level `monitors` declarations are accepted during Claude Code's migration period but Canary records a warning recommending `experimental.monitors`.

A previously generated `discovery.json` that predates these fields remains valid when the live plugin has no LSP servers, monitors or plugin dependencies. This avoids forcing unrelated plugins to regenerate suites just because Canary learned about new component types.

## Release selectors

The suite uses the same selectors as `plugin-matrix`:

```bash
# Newest 10 published releases
claude-canary plugin-suite --plugin ./my-plugin --last 10

# Exact releases
claude-canary plugin-suite \
  --plugin ./my-plugin \
  --versions 2.1.231 2.1.232 2.1.233

# Inclusive published range
claude-canary plugin-suite \
  --plugin ./my-plugin \
  --from 2.1.220 \
  --to 2.1.237
```

If no selector is supplied, Canary uses the same default as `plugin-matrix`: the newest 10 published releases.

Every underlying scenario uses Canary's authenticated Claude Code version cache. Missing releases are installed once and then reused by later suite scenarios.

## Full compatibility matrix

The Markdown report contains a release-by-scenario matrix:

```text
| Claude Code | load | command-review | hook-stop | mcp-github | Overall |
| --- | :---: | :---: | :---: | :---: | --- |
| 2.1.231 | ✅ | ✅ | ✅ | ✅ | ✅ Compatible |
| 2.1.232 | ✅ | ✅ | ❌ | ✅ | ❌ 1 failed |
| 2.1.233 | ✅ | ❌ | ❌ | ✅ | ❌ 2 failed |
```

It also includes:

- the first release with any suite failure;
- per-scenario compatible-release counts;
- the first failing release for each scenario;
- per-release failed scenario details;
- aggregate run counts;
- total tool calls, tokens, duration and cost where Claude reports cost data.

The JSON artifact keeps the full structured matrix for dashboards, CI or later badge/reporting work.

Artifacts are written under:

```text
.canary/results/<timestamp>-<plugin>-plugin-suite.json
.canary/results/<timestamp>-<plugin>-plugin-suite.md
```

Individual `runScenario` result artifacts remain available for debugging a failed cell. `plugin-suite` suppresses the redundant per-scenario matrix summary files that `plugin-matrix` would otherwise create.

## Run-budget safety

A full suite multiplies the number of scenarios by the number of releases. A plugin with 20 generated scenarios tested across 10 releases already means 200 Claude runs.

Canary therefore refuses suites above 200 runs by default:

```text
20 scenarios × 10 releases = 200 runs  # allowed
21 scenarios × 10 releases = 210 runs  # refused by default
```

After reviewing the expected token/cost impact, you can explicitly raise the budget:

```bash
claude-canary plugin-suite \
  --plugin ./my-plugin \
  --last 10 \
  --max-runs 300
```

`--max-runs` is itself capped at 1000. Narrowing the release selector is usually preferable to blindly raising the limit.

## CI behavior

By default, any failed scenario/release cell makes `plugin-suite` exit non-zero. That makes the suite usable as a release compatibility gate.

For report-only historical runs:

```bash
claude-canary plugin-suite \
  --plugin ./my-plugin \
  --last 10 \
  --allow-incompatible
```

For machine-readable output:

```bash
claude-canary plugin-suite \
  --plugin ./my-plugin \
  --last 10 \
  --json
```

## `plugin-suite` vs `plugin-matrix`

Use `plugin-suite` when you want the complete plugin surface in one compatibility report.

Use `plugin-matrix` when you are investigating one specific contract, for example a command regression:

```bash
claude-canary plugin-matrix \
  .canary/plugins/my-plugin/command-review.canary.yml \
  --plugin ./my-plugin \
  --from 2.1.220 \
  --to 2.1.237
```

This keeps the broad release gate and the focused debugging workflow separate while reusing the same version-selection, isolation and execution model.

## Isolation and limitations

- Every scenario/release run starts from the same repository commit through Canary's detached-worktree runner.
- The plugin is copied to a fresh temporary runtime directory for each underlying run.
- Plugin trees and generated suite scenario files must not be symlinks.
- The suite directory must carry the Canary `plugin-init` marker and a matching current `discovery.json`.
- Missing generated component scenarios are rejected; additional custom scenarios are allowed.
- Monitor commands are never launched by Canary's suite generator or freshness guard.
- Plugin dependency declarations are statically tracked; Canary does not act as a marketplace/package resolver.
- LSP smoke scenarios depend on the plugin's declared external language-server executable being available in the test environment.
- Generated smoke scenarios are scaffolds. Review them before treating the suite as proof of every domain-specific plugin contract.
- A release is marked compatible only when every scenario in the suite passes on that release.
- `firstIncompatibleVersion` is the earliest failed release in the selected set, not a monotonic binary-search proof. Use `bisect` for a known-good/known-bad regression boundary.
