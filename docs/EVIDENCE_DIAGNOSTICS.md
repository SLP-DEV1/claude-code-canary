# Compatibility evidence diagnostics

Compatibility manifests, registries and `canary.lock` are intended to be portable evidence. When one of those files is malformed or no longer matches the current test target, `compat diagnose` explains the problem without running Claude or mutating the artifact.

```bash
claude-canary compat diagnose plugin.compat.json
```

A healthy artifact prints:

```text
Compatibility evidence diagnostics
Status: OK
Artifact: manifest
Compatibility manifest is valid and current.
```

Invalid and stale states are separate:

- **INVALID** means the file cannot be trusted as the declared compatibility artifact, for example malformed JSON, a schema violation or an invalid timestamp.
- **STALE** means the structure is valid but the evidence no longer matches the supplied current target, hash, freshness window or lock state.

Every diagnostic contains a stable code, a severity, an optional field path and a concrete remediation hint. `--json` exposes the same information for CI or tooling.

## Verify a manifest against current evidence

`--evidence` recomputes the canonical evidence SHA-256 and compares it with `evidenceHash`:

```bash
claude-canary compat diagnose plugin.compat.json \
  --evidence .canary/results/latest-suite.json
```

If the run evidence changed after the manifest was produced, the command reports `evidence-hash-mismatch` and marks the artifact stale.

The manifest `suiteHash` can also be checked when you have the exact definition object that was hashed while creating the manifest:

```bash
claude-canary compat diagnose plugin.compat.json \
  --suite-definition suite-definition.json
```

The built-in `compat manifest` command currently hashes the definition object `{ "suite": <evidence.suite>, "suitePath": <evidence.suitePath> }`. Pass that same logical object rather than assuming the hash represents the raw suite YAML bytes.

## Check target drift

Expected target flags make accidental reuse immediately visible:

```bash
claude-canary compat diagnose plugin.compat.json \
  --claude 2.1.263 \
  --platform linux-x64 \
  --component my-plugin \
  --component-version 1.4.0
```

Mismatches are reported independently, so a single command can show that evidence is both old and for the wrong release/platform.

## Freshness windows

Use `--max-age-days` when your CI or registry policy requires evidence to be refreshed periodically:

```bash
claude-canary compat diagnose workspace.compat-registry.json --max-age-days 14
```

Canary checks manifest `createdAt` values and registry/lock `generatedAt` values. Invalid timestamps are an integrity error. Evidence older than the configured window is valid-but-stale.

No freshness window is imposed by default; repositories choose their own policy explicitly.

## Registry diagnostics

For compatibility registries, Canary also detects:

- `generatedAt` timestamps older than embedded manifest evidence;
- conflicting manifests for the same component/version + Claude Code release + platform identity when their suite, result or evidence differs;
- malformed embedded manifests with exact schema paths.

Rebuild stale registries from the intended manifest set:

```bash
claude-canary compat merge \
  --name workspace \
  --output workspace.compat-registry.json \
  plugin-a.compat.json plugin-b.compat.json
```

## `canary.lock` diagnostics

Supply current manifests to compare the lock against the evidence you are about to use:

```bash
claude-canary compat diagnose canary.lock \
  --manifests plugin-a.compat.json,plugin-b.compat.json \
  --claude 2.1.263 \
  --platform linux-x64
```

The output distinguishes missing evidence, suite drift and evidence drift. Before replacing a reviewed lock, inspect the semantic change:

```bash
claude-canary lock diff canary.lock canary.lock.next
```

Then recreate the lock only after accepting the new compatibility state.

## Machine-readable output and exit codes

```bash
claude-canary compat diagnose plugin.compat.json --json
```

The JSON result contains:

```json
{
  "schemaVersion": 1,
  "kind": "manifest",
  "valid": true,
  "stale": false,
  "passed": true,
  "summary": "Compatibility manifest is valid and current.",
  "diagnostics": []
}
```

Exit behavior follows Canary's existing categories:

- `0`: valid and current;
- `2`: valid but stale (`regression` category);
- `4`: invalid input/artifact (`configuration` category).

This makes the command suitable as a cheap preflight before publishing a registry, updating a badge, consuming a lockfile or starting a more expensive compatibility workflow.
