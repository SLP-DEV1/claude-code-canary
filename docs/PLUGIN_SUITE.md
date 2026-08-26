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
7. any custom scenarios added to the generated directory

You can point at another Canary-generated suite directory with:

```bash
claude-canary plugin-suite \
  --plugin ./my-plugin \
  --suite .canary/custom-plugin-suite \
  --last 10
```

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
- The suite directory must carry the Canary `plugin-init` marker.
- Generated smoke scenarios are scaffolds. Review them before treating the suite as proof of every domain-specific plugin contract.
- A release is marked compatible only when every scenario in the suite passes on that release.
- `firstIncompatibleVersion` is the earliest failed release in the selected set, not a monotonic binary-search proof. Use `bisect` for a known-good/known-bad regression boundary.
