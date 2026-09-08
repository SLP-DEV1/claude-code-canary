# Ecosystem publishing

Claude Code Canary v2.2 keeps ecosystem distribution file-based and reproducible. Independent projects can sign compatibility evidence, publish evidence-backed badges, describe community scenario packs, and exchange compatibility registries without a Canary-hosted service.

## Signed compatibility manifests

Create an Ed25519 key pair once:

```bash
openssl genpkey -algorithm ED25519 -out canary-signing.pem
openssl pkey -in canary-signing.pem -pubout -out canary-signing.pub.pem
```

Sign a validated compatibility manifest:

```bash
claude-canary compat diagnose .canary/compatibility.json
claude-canary compat sign .canary/compatibility.json \
  --private-key canary-signing.pem \
  --output .canary/compatibility.signed.json
```

Verify it before consuming or publishing it:

```bash
claude-canary compat verify .canary/compatibility.signed.json \
  --public-key canary-signing.pub.pem
```

The signed envelope contains the original manifest, its canonical SHA-256 hash, the Ed25519 public-key fingerprint and a detached signature over the 32-byte canonical manifest hash. No publish-time timestamp is injected, so the same manifest and key produce the same signed envelope.

For CI, prefer `--private-key-env <NAME>` and `--public-key-env <NAME>` so PEM material does not appear in command-line arguments or temporary repository files. The environment-variable reader also accepts PEM strings whose newlines were stored as literal `\\n` sequences.

`examples/github-actions/publish-signed-manifest.yml` is a complete release-asset workflow. It:

- diagnoses the manifest before signing;
- reads the private key from the `CANARY_MANIFEST_SIGNING_KEY` GitHub Actions secret;
- reads the public key from the `CANARY_MANIFEST_PUBLIC_KEY` repository variable;
- verifies the newly generated envelope before publication;
- uploads only to an already-existing GitHub Release;
- uses `contents: write` only because release asset upload requires it;
- pins checkout and setup-node to immutable commit SHAs.

Do not use pull-request workflows with repository signing secrets. Keep the signing workflow manually dispatched, release-triggered, or otherwise restricted to trusted repository refs.

## Community scenario-pack discovery metadata

A scenario pack remains defined by `canary-pack.yml`; discovery metadata is separate so the strict installation manifest does not need ecosystem-specific fields.

Generate reusable metadata after Canary verifies every declared pack file:

```bash
claude-canary pack metadata ./my-pack \
  --tag plugins \
  --tag regression \
  --author "Example Maintainer" \
  --license MIT \
  --repository https://github.com/example/canary-pack \
  --homepage https://example.com/canary-pack
```

The default output is `my-pack/canary-pack.discovery.json`. It contains:

- pack name, version and description;
- declared network/mutating capabilities;
- normalized tags and authors;
- optional license/repository/homepage metadata;
- a canonical hash of `canary-pack.yml`;
- a canonical hash of its declared file list;
- the verified file count.

No timestamp is included. Discovery metadata is therefore cacheable and reproducible for the same pack and metadata inputs.

Community indexes can combine metadata files into a deterministic catalog:

```bash
claude-canary pack catalog \
  packs/alpha/canary-pack.discovery.json \
  packs/beta/canary-pack.discovery.json \
  --output scenario-packs.json
```

Catalog entries are deduplicated by pack name, version and manifest hash. HTTP(S) URLs and conservative lowercase tags are validated before output.

## Evidence-backed compatibility badges

The older `compatibilityBadgeMarkdown()` helper points at shields.io and only encodes the visible result. v2.2 adds a self-contained evidence-backed publication format:

```bash
claude-canary compat badge .canary/compatibility.json \
  --output .canary/badge \
  --base-url https://example.github.io/project/compatibility \
  --evidence-url https://example.github.io/project/registry/manifests/<hash>.json
```

The output contains:

```text
badge.svg
badge.json
badge.md
manifest.json
```

`badge.svg` is generated locally without an external badge service. Its accessible title includes the component target and full evidence hash. `badge.json` binds the displayed result to the canonical manifest hash, `evidenceHash`, `suiteHash`, Claude Code release and platform. `badge.md` links the rendered badge to the supplied evidence URL, or to the copied `manifest.json` when no external evidence URL is given.

This makes the visual badge replaceable without changing the evidence contract: consumers can verify `badge.json` and the copied manifest instead of trusting pixels.

## Registry import/export

Use `registry export` to share only a relevant slice of a larger registry:

```bash
claude-canary registry export registry.json \
  --component my-plugin \
  --platform linux-x64 \
  --result pass \
  --output my-plugin-linux.json
```

Supported filters are `--component`, `--component-version`, `--platform`, `--claude` and `--result`. Export preserves the source registry's `generatedAt` value instead of pretending the filtered copy is newer evidence.

Import independent registries with conflict checks:

```bash
claude-canary registry import local.json upstream-a.json upstream-b.json \
  --output merged.json
```

Exact duplicate manifests are removed by the canonical hash of the complete manifest. Two different manifests that happen to reference the same `evidenceHash` are preserved. This is important because evidence identity is not manifest identity.

For the same component/version/platform/Claude Code target, divergent evidence is reported as an evidence conflict. Contradictory results such as `pass` and `fail` fail closed by default. After explicit review they can be preserved with:

```bash
claude-canary registry import local.json upstream.json \
  --allow-result-conflicts \
  --output merged.json
```

`--json` returns the import conflict list, added count and duplicate count for CI policy decisions.

The existing `mergeCompatibilityRegistries()` helper now also deduplicates by the canonical full-manifest hash rather than `evidenceHash`, so aggregation and the new exchange tooling use the same collision-safe identity rule.

## Suggested publishing chain

A portable end-to-end flow is:

1. run compatibility scenarios and create a manifest;
2. run `compat diagnose`;
3. sign the manifest and verify the signature;
4. add the manifest to an independent registry;
5. use `registry publish` for the static registry site/release bundle;
6. use `compat badge` for repository README or documentation badges;
7. publish scenario-pack discovery metadata/catalogs separately from compatibility evidence.

Private keys, prompts, transcripts, credentials and raw environment values should never be added to registries, badges, scenario-pack metadata or static Pages bundles.
