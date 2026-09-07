# `suite init`

`claude-canary suite init` bootstraps a validated scenario suite for an existing workspace. It is interactive in a terminal and falls back to deterministic defaults in non-interactive environments.

## Quick start

```bash
claude-canary suite init
claude-canary suite .canary/release.suite.yml --list
```

By default Canary creates `.canary/release.suite.yml`, infers the suite name from `package.json` or the workspace directory, and includes both `.canary/**/*.canary.yml` and `.canary/**/*.canary.yaml`.

The initializer validates the generated suite with the same schema used by normal suite execution and resolves existing matching scenarios before it writes the file. Invalid scenario files therefore fail early instead of producing a broken suite.

## Non-interactive use

Use `--yes` to skip prompts, for example in scripts or scaffolding tools:

```bash
claude-canary suite init --yes \
  --name release \
  --include '.canary/**/*.canary.yml' \
  --concurrency 2 \
  --max-runs 250
```

`--include` can be repeated or given as a comma-separated list. `--reuse-results` enables safe result reuse and `--fail-fast` carries those policies into the generated suite.

## Safe overwrite and preview

Existing suite files are not overwritten unless `--force` is supplied or the interactive overwrite prompt is accepted.

Use `--dry-run` to inspect the exact YAML without writing anything:

```bash
claude-canary suite init --yes --dry-run
```

The output path must remain inside the current workspace. This prevents an accidental `../` output path from overwriting unrelated files.

## Machine-readable result

Add `--json` to return the generated suite, resolved output path and discovered scenario list as JSON:

```bash
claude-canary suite init --yes --json
```

## Options

- `--output <file>`: suite file, default `.canary/release.suite.yml`
- `--name <name>`: suite name
- `--include <glob>`: scenario glob; repeat or comma-separate values
- `--concurrency <n>`: parallel scenarios, from 1 to 32
- `--max-runs <n>`: run budget, up to 10,000
- `--fail-fast`: stop after the first failed scenario
- `--reuse-results`: reuse compatible cached results
- `--force`: replace an existing suite
- `--dry-run`: print YAML without writing it
- `--yes`: use defaults without prompts
- `--json`: print the initializer result as JSON
