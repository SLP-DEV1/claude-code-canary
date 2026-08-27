# Releasing Claude Code Canary

This checklist is the release contract for v1.x.

## 1. Pre-release gate

The release commit must have:

- `package.json`, `package-lock.json` and `src/version.ts` on the same version;
- `npm run version:check` green;
- `npm run check` green after a clean `npm ci`;
- package dry-run green;
- CI green on Node 20, 22 and 24 on Linux plus Node 22 on Windows and macOS;
- CodeQL green;
- the latest manual `full` Live Claude E2E green for compatibility-sensitive releases;
- a reviewed `CHANGELOG.md` entry;
- no temporary release-generation workflows or debug files;
- the root `action.yml` valid and tested;
- README examples updated for the intended major tag.

Check locally:

```bash
npm ci --ignore-scripts
npm run version:check
npm run check
npm pack --dry-run --ignore-scripts
node dist/index.js --version
```

## 2. Versioning

Claude Canary follows semantic versioning from v1.0.0 onward.

- patch: backwards-compatible fixes;
- minor: backwards-compatible features;
- major: incompatible CLI, Action, scenario-schema, result-schema or public API changes.

The scenario and core run-result schemas have their own explicit integer schema versions. Never silently reinterpret `version: 1` or `schemaVersion: 1` data with incompatible semantics.

Prepare all version-bearing files with one command:

```bash
npm run release:version -- 1.0.1
npm run version:check
```

The helper updates `package.json`, the root package metadata in `package-lock.json`, and `src/version.ts`. Review the diff before committing it.

For the changelog, move the intended entries out of `[Unreleased]` into a dated release heading such as:

```markdown
## [1.0.1] - 2026-08-28
```

Do not tag until the version commit has passed normal CI, CodeQL and the release-required live E2E gate.

## 3. GitHub release tags

Create an immutable release tag for every version, for example:

```text
v1.0.0
v1.0.1
v1.1.0
```

The exact tag is the reproducible release identity and must never be rewritten after publication.

For Action consumers, maintain the moving major alias `v1` on the latest compatible v1.x release. Consumers can then choose:

```yaml
uses: SLP-DEV1/claude-code-canary@v1       # latest compatible v1
uses: SLP-DEV1/claude-code-canary@v1.0.1   # exact release
```

`.github/workflows/release.yml` moves `v1` only after the npm publish step succeeds, so a failed package release cannot advance the compatibility channel.

## 4. npm publication

The release workflow uses a GitHub-hosted runner, Node 24 and an npm 11 CLI that supports Trusted Publishing. It grants `id-token: write` for OIDC and does not require a long-lived publish token once npm Trusted Publishing is configured.

For an existing npm package, configure its Trusted Publisher on npmjs.com with:

- GitHub user/organization: `SLP-DEV1`
- repository: `claude-code-canary`
- workflow filename: `release.yml`
- allowed action: `npm publish`

The repository URL in `package.json` must continue to match this GitHub repository.

### First publication bootstrap

npm Trusted Publisher configuration requires the package to exist first. If `claude-code-canary` has never been published, create a short-lived granular npm token with only the permissions needed for this package and store it temporarily as the repository Actions secret `NPM_TOKEN`.

The same release workflow exposes that secret only to `npm publish` as an optional bootstrap fallback. After the first successful publication:

1. configure npm Trusted Publishing for `release.yml`;
2. run a later patch publication through OIDC to verify it;
3. delete the `NPM_TOKEN` repository secret when it is no longer needed.

Never commit an npm token or expose it to pull-request workflows.

## 5. Release sequence

For a patch such as v1.0.1:

```bash
npm run release:version -- 1.0.1
npm run version:check
```

Then:

1. finalize the `CHANGELOG.md` heading/date;
2. commit and push the release preparation to `main`;
3. wait for CI and CodeQL to pass;
4. run the manual **Live Claude E2E** workflow in `full` mode and require it to pass;
5. create and push the exact tag `v1.0.1` on that tested commit;
6. `.github/workflows/release.yml` verifies the tag/package version, runs the complete check suite, dry-runs the tarball, publishes npm, then moves `v1` to the same commit;
7. create the GitHub Release from the exact tag and use the reviewed changelog as release notes;
8. perform the Marketplace UI step if the Action is being published/listed there.

If a tag-triggered npm publication needs to be retried, use the workflow's manual `tag` input with the same immutable exact tag. Do not move or recreate the exact tag.

## 6. GitHub Marketplace

The repository is structured for GitHub Marketplace publication:

- public repository;
- one root `action.yml`;
- Action name and description;
- branding icon/color;
- documented inputs and outputs;
- tagged release workflow.

The final Marketplace publication is an account/UI operation:

1. Open **Releases** in the repository.
2. Choose **Draft a new release**.
3. Select the already-tested exact release tag, for example `v1.0.1`.
4. Enable **Publish this Action to the GitHub Marketplace**.
5. Resolve any Marketplace validation warning GitHub displays.
6. Choose appropriate categories such as **Continuous integration** and **Code quality** when offered.
7. Accept the GitHub Marketplace Developer Agreement if the account has not already done so.
8. Complete the account's required two-factor authentication step.
9. Publish the release.

Do not claim Marketplace availability in the README until GitHub confirms the listing is published.

## 7. README installation text

Until the first npm package publication is confirmed, keep the source-install instructions in the README. After npm publication succeeds, replace that section with the stable installation command:

```bash
npm install --global claude-code-canary
```

The exact release tag and the `v1` Action alias are separate from npm distribution and should both be post-release smoke tested.

## 8. Release notes template

```markdown
# Claude Code Canary vX.Y.Z

## Highlights
- ...

## Compatibility
- Scenario schema: v1
- Core result schema: v1
- Node.js: 20+
- GitHub Action: `@v1`

## Fixed
- ...

## Security / hardening
- ...

## Upgrade
No migration is required from vX.Y.Z-1.
```

## 9. Post-release checks

After publishing:

- verify the npm package and provenance information;
- verify the GitHub release page and Marketplace listing when applicable;
- run a tiny workflow using the exact tag;
- run the same workflow using `@v1`;
- verify Step Summary and artifact upload;
- update the README install section after the first npm publication;
- check GitHub's dependency/security alerts;
- confirm the release commit is green in CI.

If a release is broken, publish a new patch release. Do not rewrite an immutable exact release tag.
