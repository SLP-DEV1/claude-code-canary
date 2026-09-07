# Suite migration

`claude-canary suite migrate` converts older or hand-written suite layouts into the current validated scenario-suite contract without making legacy syntax part of the normal runtime parser.

## Safe default

```bash
claude-canary suite migrate .canary/legacy.suite.yml
```

The source is left untouched. Canary writes a sibling file such as:

```text
.canary/legacy.migrated.suite.yml
```

The migrated document is validated with the same `SuiteSchema` used by `claude-canary suite` before any file is written.

Preview first:

```bash
claude-canary suite migrate .canary/legacy.suite.yml --dry-run
```

Machine-readable migration details:

```bash
claude-canary suite migrate .canary/legacy.suite.yml --dry-run --json
```

## In-place migration

Use `--in-place` only when you want to replace the source:

```bash
claude-canary suite migrate .canary/legacy.suite.yml --in-place
```

By default this creates:

```text
.canary/legacy.suite.yml.bak
```

If that backup already exists, migration stops. `--force` may replace an existing output or backup. `--no-backup` disables the backup only when combined with `--in-place`.

An already-current suite is a no-op in `--in-place` mode: the file is not reformatted and no backup is created.

## Supported legacy shapes

Migration is intentionally explicit and bounded. Supported aliases are:

| Legacy form | Current field |
| --- | --- |
| `suite` | `name` |
| `includes`, `files`, `globs`, `scenario_globs` | `include` |
| `excludes`, `ignore` | `exclude` |
| `parallel`, `workers` | `concurrency` |
| `failFast` | `fail_fast` |
| `maxRuns` | `max_runs` |
| `reuseResults` | `reuse_results` |
| scenario string | `{ path: ... }` |
| scenario `file` / `scenario` | scenario `path` |
| scenario `always_run` / `alwaysRun` | scenario `always` |

A top-level YAML list is treated as a list of scenario entries and wrapped in a version-1 suite.

Missing `version` is upgraded to `version: 1`; `version: 0` is also upgraded. Versions newer than the current contract are rejected.

## Fail-closed behavior

Migration never silently drops unknown keys. If a legacy file contains a field Canary cannot map, the command stops and names the unsupported field. Conflicting aliases also stop migration.

This is deliberate: migration should preserve intent, not guess it.

## Useful options

```text
--output <file>   explicit destination
--in-place        replace source and create .bak
--no-backup       disable .bak for in-place migration
--name <name>     override migrated suite name
--force           replace an existing destination/backup
--dry-run         validate and print without writing
--json            emit structured migration details
```

After migration, inspect the resolved scenario selection before running:

```bash
claude-canary suite .canary/legacy.migrated.suite.yml --list
```
