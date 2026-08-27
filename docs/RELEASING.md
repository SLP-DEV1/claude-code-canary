# Releasing Claude Code Canary

This checklist is the release contract for Claude Code Canary v2 and later compatible releases.

## 1. Pre-release gate

The release commit must have:

- `package.json`, `package-lock.json` and `src/version.ts` on the same version;
- `npm run version:check` green;
- `npm run check` green after a clean `npm ci`;
- package dry-run green;
- CI green on Node 20, 22 and 24 on Linux plus Node 22 on Windows and macOS;
- CodeQL green;
- a successful `Live Claude E2E (full)` run on the **exact release commit**;
- a reviewed `CHANGELOG.md` entry;
- no temporary generation/debug workflows or files;
- the root `action.yml` valid and tested;
- README examples updated for the intended major Action tag.

Check locally:

```bash
npm ci --ignore-scripts
npm run version:check
npm run check
npm pack --dry-run --ignore-scripts
node dist/v2-cli.js --version
```

## 2. Versioning

Claude Canary follows semantic versioning.

- patch: backwards-compatible fixes;
- minor: backwards-compatible features;
- major: incompatible CLI, Action, scenario-schema, result-schema or public API changes.

Public data contracts also carry explicit schema versions. Never silently reinterpret an existing schema version with incompatible semantics.

Prepare all version-bearing files with one command:

```bash
npm run release:version -- 2.0.0
npm run version:check
```

The helper updates `package.json`, root package metadata in `package-lock.json`, the lockfile CLI `bin` mapping and `src/version.ts`. Review the diff before committing it.

For the changelog, move intended entries out of `[Unreleased]` into a dated release heading:

```markdown
## [2.0.0] - 2026-08-28
```

## 3. Immutable tags and moving major channels

Every published version gets one immutable exact tag, for example:

```text
v1.2.0
v2.0.0
v2.1.0
```

Exact tags are reproducible release identities and must never be rewritten after publication.

Action consumers may use the moving major alias matching their compatibility line:

```yaml
uses: SLP-DEV1/claude-code-canary@v1       # latest compatible v1.x
uses: SLP-DEV1/claude-code-canary@v2       # latest compatible v2.x
uses: SLP-DEV1/claude-code-canary@v2.0.0   # exact immutable release
```

`.github/workflows/release.yml` derives the moving major tag from the package version. Publishing v2 therefore moves only `v2`; it never rewrites `v1`.

## 4. Explicit release-candidate promotion

For releases that use `.github/release-candidate.json`, changing that file on `main` is the explicit publication request.

Example:

```json
{
  "version": "2.0.0",
  "publish": true,
  "channel": "v2"
}
```

The release-candidate flow is intentionally gated:

1. merge a candidate whose package metadata, changelog and release-candidate version agree;
2. the candidate-file change triggers `Live Claude E2E (full)` on that exact `main` commit;
3. a missing provider credential makes this release-evidence run fail rather than silently skip;
4. only a successful full E2E run can activate `.github/workflows/release-after-e2e.yml`;
5. the promotion workflow validates candidate/package/channel consistency and creates the immutable exact tag on the tested SHA;
6. it explicitly dispatches `release.yml` with that exact tag;
7. `release.yml` independently rechecks the full-E2E evidence before npm/GitHub publication.

This keeps the full live gate in place while removing a manual tag race between testing and publication.

Do not edit the release-candidate file casually: on `main`, a change with `publish: true` is a release operation.

## 5. Manual release path

The hardened publish workflow still supports a manual path for retries or releases not using candidate promotion.

Before tagging, run **Live Claude E2E** in `full` mode on the exact intended commit. Then create the immutable tag and dispatch `release.yml` with that same tag.

A retry must reuse the same immutable tag. Do not move or recreate an exact release tag.

### Release evidence semantics

The publish gate accepts only a successful workflow run whose display title is:

```text
Live Claude E2E (full)
```

and whose `head_sha` equals the exact commit checked out from the release tag.

Scheduled `core` runs do not count. Manual `core` runs do not count. A full run from another commit does not count. A manual/release-triggered run without provider credentials fails rather than being recorded as successful skipped evidence.

## 6. npm publication

The publish workflow uses Node 24 and an OIDC-capable npm CLI. It grants `id-token: write` for Trusted Publishing provenance.

Configure the npm Trusted Publisher for:

- GitHub user/organization: `SLP-DEV1`
- repository: `claude-code-canary`
- workflow filename: `release.yml`
- allowed action: `npm publish`

The workflow is rerun-safe. It first checks whether the exact package version already exists. If npm succeeded in a previous attempt but a later release step failed, a retry skips duplicate publication, verifies the public registry copy and continues.

A long-lived npm token must not be committed. `NPM_TOKEN`, when present, is only an optional bootstrap fallback for the publish step; OIDC Trusted Publishing is preferred.

## 7. Hardened publish workflow sequence

For the exact release tag, `.github/workflows/release.yml`:

1. validates exact `vX.Y.Z` tag syntax;
2. checks out that immutable tag and captures its SHA;
3. installs dependencies, runs `npm run check` and performs a tarball dry-run;
4. verifies package version == release tag;
5. queries GitHub Actions and requires successful `Live Claude E2E (full)` evidence for the exact SHA;
6. checks whether the npm version is already public;
7. publishes with provenance if needed;
8. verifies the package from the public npm registry;
9. creates the GitHub Release if missing;
10. derives `v<major>` from the package version and moves only that floating Action tag after all previous steps succeed.

A failed or partial release cannot advance the moving major Action channel.

## 8. GitHub Marketplace

The root `action.yml` contains Marketplace metadata, branding, inputs and outputs. The normal publish workflow creates the GitHub Release automatically.

For a new major release, verify the existing Marketplace listing resolves the intended Action version/channel. If GitHub requires release-specific Marketplace UI confirmation, edit the created release and complete that UI step.

Recommended categories remain **Continuous integration** and **Code quality/Testing** where offered.

## 9. Post-release checks

After publication:

- verify `claude-code-canary@X.Y.Z` and provenance on npm;
- verify the immutable GitHub Release;
- verify the matching moving major tag (`v2` for v2.x, etc.);
- run a tiny workflow using the exact tag;
- run the same workflow using the moving major tag;
- verify Step Summary and artifact upload;
- verify Marketplace resolution when applicable;
- check dependency/security alerts;
- confirm the release commit remains green in CI and CodeQL.

If a published release is broken, publish a new patch release. Never rewrite an immutable exact tag.

## 10. Release notes template

```markdown
# Claude Code Canary vX.Y.Z

## Highlights
- ...

## Compatibility
- Node.js: 20+
- Scenario/result schemas: see `schemas/`
- GitHub Action major channel: `@vX`

## Fixed
- ...

## Security / hardening
- ...

## Upgrade
Document any required migration from the previous major/minor here.
```

GitHub generated notes provide the commit/PR baseline. `CHANGELOG.md` remains the reviewed human-maintained summary of notable behavior changes.
