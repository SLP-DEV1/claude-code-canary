# Releasing Claude Code Canary

This checklist is the release contract for v1.x.

## 1. Pre-release gate

The release branch must have:

- `package.json` and `src/version.ts` on the same version;
- a committed `package-lock.json` matching `package.json`;
- `npm run check` green after a clean `npm ci`;
- package dry-run green;
- CI green on Node 20, 22 and 24 on Linux plus Node 22 on Windows and macOS;
- CodeQL green;
- a reviewed `CHANGELOG.md` entry;
- no temporary release-generation workflows or debug files;
- the root `action.yml` valid and tested;
- README examples updated for the intended major tag.

Check locally:

```bash
npm ci --ignore-scripts
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

## 3. GitHub release tags

Create an immutable release tag for every version, for example:

```text
v1.0.0
v1.0.1
v1.1.0
```

The release title should match the version and the body should summarize user-visible additions, fixes, security hardening and migration notes.

For Action consumers, maintain the moving major alias `v1` on the latest compatible v1.x release. Consumers can then choose:

```yaml
uses: SLP-DEV1/claude-code-canary@v1       # latest compatible v1
uses: SLP-DEV1/claude-code-canary@v1.0.0   # exact release
```

The exact release is the reproducible option; `v1` is the convenient compatibility channel.

## 4. GitHub Marketplace

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
3. Select/create the release tag, for example `v1.0.0`.
4. Enable **Publish this Action to the GitHub Marketplace**.
5. Resolve any Marketplace validation warning GitHub displays.
6. Choose appropriate categories such as **Continuous integration** and **Code quality** when offered.
7. Accept the GitHub Marketplace Developer Agreement if the account has not already done so.
8. Complete the account's required two-factor authentication step.
9. Publish the release.
10. Create/update the `v1` major tag to the same tested release commit.

Do not claim Marketplace availability in the README until GitHub confirms the listing is published.

## 5. npm package

The package metadata is prepared for public npm publication, but Marketplace publication does not require npm.

If publishing the npm package, use an authenticated release environment and verify the tarball first:

```bash
npm ci --ignore-scripts
npm pack --dry-run --ignore-scripts
npm publish --provenance --access public
```

After npm publication, the README source-install section can be replaced with the stable installation command:

```bash
npm install --global claude-code-canary
```

Never put an npm token into repository files or a pull-request workflow.

## 6. Release notes template

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

## 7. Post-release checks

After publishing:

- verify the release page and Marketplace listing;
- run a tiny workflow using the exact tag;
- run the same workflow using `@v1`;
- verify Step Summary and artifact upload;
- verify README badges;
- check GitHub's dependency/security alerts;
- confirm the release commit is green in CI.

If a release is broken, publish a new patch release. Do not rewrite an immutable exact release tag.
