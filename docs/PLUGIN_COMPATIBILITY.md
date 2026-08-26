# Plugin compatibility matrices

Claude Code Canary can test one plugin against multiple published Claude Code releases while keeping the repository starting state and scenario identical.

## Quick start

Create or reuse a deterministic smoke scenario, then run:

```bash
claude-canary plugin-matrix .canary/plugin-smoke.canary.yml \
  --plugin ./my-plugin \
  --last 10
```

Without a selector, `plugin-matrix` also defaults to the newest 10 published releases.

Other selectors:

```bash
# Exact releases
claude-canary plugin-matrix .canary/plugin-smoke.canary.yml \
  --plugin ./my-plugin \
  --versions 2.1.230 2.1.231 2.1.232

# Inclusive published-release range
claude-canary plugin-matrix .canary/plugin-smoke.canary.yml \
  --plugin ./my-plugin \
  --from 2.1.220 \
  --to 2.1.237
```

Matrices are capped at 50 releases so an accidental broad range cannot launch an unbounded number of Claude runs.

## What Canary does

For every selected release Canary:

1. resolves the exact published Claude Code version;
2. installs or reuses it through Canary's authenticated version cache;
3. creates the normal detached Git worktree from the same repository commit;
4. copies the plugin into a fresh temporary runtime directory;
5. injects that copy through `--plugin-dir`;
6. runs the same deterministic Canary scenario;
7. records pass/fail, assertion failures, tool calls, tokens, duration and cost when available.

The source plugin directory is never passed directly to Claude, so a run cannot modify the original plugin through the injected path.

## Output

Each matrix writes both JSON and Markdown under `.canary/results/`:

```text
<timestamp>-<scenario>-<plugin>-plugin-compat.json
<timestamp>-<scenario>-<plugin>-plugin-compat.md
```

Example Markdown:

```text
| Claude Code | Result | Tool calls | Tokens | Failure |
| --- | --- | ---: | ---: | --- |
| 2.1.231 | ✅ Compatible | 8 | 12430 | |
| 2.1.232 | ✅ Compatible | 9 | 13102 | |
| 2.1.233 | ❌ Incompatible | 3 | 4190 | Plugin command was not available |
```

The report also identifies the first incompatible release present in the tested matrix.

## CI behavior

By default the command exits non-zero when at least one tested release is incompatible. This makes it useful as a compatibility gate.

For documentation-only runs where historical failures are expected, use:

```bash
claude-canary plugin-matrix .canary/plugin-smoke.canary.yml \
  --plugin ./my-plugin \
  --last 10 \
  --allow-incompatible
```

## Writing a useful smoke scenario

A compatibility matrix is only as meaningful as its deterministic scenario. Prefer assertions that prove the plugin actually participated in the task. Examples:

- ask Claude to invoke a command/tool exposed by the plugin;
- verify a deterministic file produced by that command;
- use a verification command that checks plugin-generated output;
- require a specific changed file or content marker.

Avoid a scenario that can pass without touching the plugin, because that only proves Claude Code itself still works.

## Isolation and limitations

- Every version starts from the same Git commit in a detached worktree.
- The plugin is copied into a fresh temporary directory per run.
- Auto-memory is disabled for the plugin run.
- The plugin matrix does not silently add `bypassPermissions`.
- Project/user environment and organization policy can still affect Claude Code unless your scenario/setup explicitly controls them.
- A failed result means the complete plugin smoke scenario failed on that release. Inspect the failure column and per-run JSON artifact before concluding that the Claude Code release itself is defective.
- `firstIncompatibleVersion` means the earliest failed release in the selected matrix. It is not a binary-search proof of a monotonic regression boundary.

For a monotonic known-good/known-bad boundary, use `claude-canary bisect` with a scenario that exercises the same plugin behavior.
