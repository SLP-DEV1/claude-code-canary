# Compatibility diffs

Canary can explain **semantic** changes between lockfiles and compatibility manifests instead of showing raw JSON key differences.

Volatile timestamps are intentionally ignored:

- `generatedAt` for `canary.lock`
- `createdAt` for compatibility manifests

That keeps a regenerated artifact from looking meaningful when only its timestamp changed.

## Lockfile diff

```bash
claude-canary lock diff canary.old.lock canary.lock
```

Typical output:

```text
Canary lock diff
Impact: COMPATIBILITY
4 semantic changes; highest impact: compatibility.

- [COMPATIBILITY] Claude Code upgraded from 2.1.262 to 2.1.263; compatibility evidence should be re-evaluated for the new release.
- [COMPATIBILITY] demo-plugin changed component version from 1.0.0 to 1.1.0; compatibility should be treated as a new component target.
- [COMPATIBILITY] demo-plugin@1.1.0 uses a different suite definition; this is not just a rerun and may change what behavior is covered.
- [EVIDENCE] demo-plugin@1.1.0 has different evidence with the same component identity; the underlying test evidence was regenerated or changed.

Ignored volatile field: generatedAt
```

The lock diff distinguishes:

- Claude Code release drift;
- platform drift;
- Canary tooling-version changes;
- component additions/removals;
- component-version changes;
- suite-definition changes (`suiteHash`);
- evidence-only changes (`evidenceHash`).

When one old and one new entry exist for the same component, a version change is reported as a component-version transition instead of noisy remove/add pairs.

## Manifest diff

```bash
claude-canary compat diff before.compat.json after.compat.json
```

A `pass -> fail` transition is classified as `REGRESSION`:

```text
Compatibility manifest diff
Impact: REGRESSION
...
- [REGRESSION] Result changed from pass to fail; this is direct regression evidence for the compared compatibility target.
```

Manifest comparison explains:

- Claude Code release and platform changes;
- component/component-version changes;
- suite-definition changes;
- pass/fail/unsupported result transitions;
- evidence refreshes;
- added and removed failure fingerprints;
- provenance metadata changes.

A `fail -> pass` transition is explained as recovered positive compatibility evidence rather than a regression.

## Machine-readable output

Both commands support `--json`:

```bash
claude-canary lock diff old.lock new.lock --json
claude-canary compat diff old.compat.json new.compat.json --json
```

The structured result contains:

```json
{
  "schemaVersion": 1,
  "kind": "manifest",
  "changed": true,
  "impact": "regression",
  "summary": "...",
  "ignoredFields": ["createdAt"],
  "changes": []
}
```

Impact levels, from lowest to highest, are:

1. `none`
2. `informational`
3. `evidence`
4. `compatibility`
5. `regression`

This makes the JSON suitable for reports, CI annotations or higher-level tooling without forcing consumers to parse human-readable text.

## Help

```bash
claude-canary lock diff --help
claude-canary compat diff --help
```
