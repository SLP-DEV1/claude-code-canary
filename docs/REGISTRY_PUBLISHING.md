# Static compatibility registry publishing

`claude-canary registry publish` turns an existing v1 compatibility registry into a static, content-addressed bundle that can be hosted without a Canary service.

The source registry remains the source of truth. Publishing does not mutate manifests, change the compatibility schema, contact GitHub, or require a hosted Canary backend.

## Build a bundle

```bash
claude-canary registry publish compatibility.registry.json \
  --output .canary/registry-site
```

Optional flags:

```text
--base-url <url>  absolute public http(s) base URL used by generated HTML links
--no-html         omit the human-readable index.html
--json            print machine-readable publish metadata
```

The output directory must either be empty or already contain Canary's `.claude-canary-registry` ownership marker. Canary refuses to clean a non-empty unowned directory.

A re-publish removes only the previously generated registry files and `manifests/` tree before rebuilding them, so stale content-addressed manifests cannot remain visible.

## Bundle layout

```text
.canary/registry-site/
├── .claude-canary-registry
├── .nojekyll
├── index.html
├── index.json
├── registry.json
├── SHA256SUMS
└── manifests/
    ├── <manifest-hash>.json
    └── ...
```

`registry.json` is the validated source registry in static form.

`index.json` is a compact lookup index grouped by component, component version and platform. Releases are sorted newest-first and link to content-addressed manifest files.

Each `manifestHash` is the canonical SHA-256 of the complete compatibility manifest. It is intentionally different from `evidenceHash`: two manifests can legitimately reference the same evidence while differing in release, component metadata or result, so `evidenceHash` is not a safe filename identity.

`SHA256SUMS` covers every published data/HTML file plus `.nojekyll`. The publisher does not inject the current time: `generatedAt` comes from the source registry, so identical registry input and options produce identical published content and checksums.

`.nojekyll` makes the directory directly suitable for GitHub Pages artifact deployment.

## GitHub Pages

A complete workflow is provided at:

```text
examples/github-actions/publish-registry-pages.yml
```

The important build step is simply:

```bash
npx claude-canary registry publish compatibility.registry.json \
  --output .canary/registry-site
```

Then upload `.canary/registry-site` with `actions/upload-pages-artifact` and deploy it with `actions/deploy-pages`.

The generated links are relative by default, which is usually best for GitHub Pages because the same bundle works at a project site, organization site, custom domain, preview host, or local static server without rebuilding it.

Use `--base-url` only when consumers need absolute URLs in the generated HTML:

```bash
claude-canary registry publish compatibility.registry.json \
  --output .canary/registry-site \
  --base-url https://example.org/compatibility
```

## GitHub Releases

The same directory is release-ready. Upload the machine-readable top-level files and content-addressed manifests as release assets:

```bash
gh release upload "$TAG" \
  .canary/registry-site/registry.json \
  .canary/registry-site/index.json \
  .canary/registry-site/SHA256SUMS \
  .canary/registry-site/manifests/*.json
```

If the human-readable browser is useful as a release asset, add `index.html` as well.

For an immutable release, publish from the exact Git commit that produced the compatibility registry and do not rebuild the registry after creating the tag. Consumers can verify downloaded assets against `SHA256SUMS`.

## Aggregating multiple registries first

Existing registry aggregation remains separate from publishing:

```bash
claude-canary compat merge \
  --name community-registry \
  --output combined.registry.json \
  registry-a.json registry-b.json

claude-canary registry publish combined.registry.json \
  --output .canary/registry-site
```

This separation keeps merge semantics inspectable and lets `compat diagnose` run before publication.

## Recommended CI order

For public evidence, use this order:

1. generate or aggregate compatibility manifests/registries;
2. run `compat diagnose` on the registry and any policy-relevant evidence;
3. build the static bundle with `registry publish`;
4. archive or deploy the exact generated directory;
5. retain `SHA256SUMS` beside the published assets.

Do not publish prompts, transcripts, credentials or raw environment values as registry metadata. The static publisher intentionally publishes only the compatibility registry and its manifests; it does not reach into raw run artifacts.

## TypeScript API

The package root exports the same pure/index and filesystem helpers:

```ts
import {
  buildStaticRegistryIndex,
  renderStaticRegistryHtml,
  publishCompatibilityRegistry,
} from 'claude-code-canary';
```

`buildStaticRegistryIndex` and `renderStaticRegistryHtml` are useful when another static-site generator owns the final presentation. `publishCompatibilityRegistry` writes the standard Pages/Release bundle.
