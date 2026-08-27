# Distribution and discovery

This guide covers the public distribution surfaces for Claude Code Canary: npm, GitHub Marketplace, GitHub releases and curated Claude Code directories.

## Distribution status

| Surface | Status | Canonical identity |
| --- | --- | --- |
| Source | Live | `SLP-DEV1/claude-code-canary` |
| GitHub Action | `@v1` is live and consumer-tested; Marketplace publication still requires the GitHub release UI | `SLP-DEV1/claude-code-canary@v1` |
| npm | Live; the release workflow verifies registry visibility and the consumer smoke installs the published package from a clean project | `claude-code-canary` |
| GitHub Release | Automated by `.github/workflows/release.yml` after release gates pass | immutable `vX.Y.Z` plus floating `v1` Action tag |
| Awesome Claude Code (`erkcet`) | Submitted; issue #20 remains open | resource suggestion #20 |

The npm install and `@v1` Action usage shown in the README are public, tested distribution paths. Do not claim a GitHub Marketplace listing until that separate UI publication is actually live.

## GitHub Marketplace

The root `action.yml` is the Marketplace metadata source. Keep it limited to one root Action and preserve:

- a unique, descriptive `name`;
- a short search-friendly `description`;
- documented inputs and outputs;
- `branding.icon` and `branding.color`;
- a public repository and tagged release.

Recommended listing identity:

- **Name:** Claude Code Canary
- **Primary category:** Continuous integration
- **Secondary category:** Testing
- **One-line positioning:** Deterministic regression tests and compatibility matrices across Claude Code releases, plugins and configs.

Marketplace publication is an account/UI operation. From the root `action.yml`, use GitHub's Marketplace publication banner to draft or edit the release, enable **Publish this Action to the GitHub Marketplace**, resolve any validation warnings, select the categories, accept the Marketplace Developer Agreement if required, complete 2FA, and publish/update the release.

The normal release automation can still create ordinary GitHub Releases and move the floating `v1` tag, but the Marketplace opt-in itself must be completed in GitHub's release UI. Repository issue #49 tracks this one remaining distribution step.

## npm

Package identity:

```text
claude-code-canary
```

Published installation:

```bash
npm install --global claude-code-canary
claude-canary --version
claude-canary doctor
```

The package is configured as public and points explicitly at the public npm registry. `.github/workflows/release.yml` uses a GitHub-hosted runner with `id-token: write`, Node 24 and an OIDC-capable npm CLI. npm publication requests provenance, verifies that the exact package version becomes visible in the public registry and only then continues the release chain.

Trusted Publisher settings:

- GitHub user/organization: `SLP-DEV1`
- Repository: `claude-code-canary`
- Workflow filename: `release.yml`
- Allowed action: `npm publish`

Prefer npm Trusted Publishing/OIDC over a long-lived publish token. `NPM_TOKEN` exists in the workflow only as an optional bootstrap fallback while trusted publishing is being configured.

Before every npm release:

```bash
npm ci --ignore-scripts
npm run version:check
npm run check
npm pack --dry-run --ignore-scripts
```

After publication, the release workflow verifies registry visibility. `.github/workflows/consumer-smoke.yml` then independently installs the published package into an empty project and exercises the public CLI/API, so repository-checkout success is not treated as proof that consumers can install the release.

## Curated Claude Code lists

### erkcet/awesome-claude-code

A project-affiliated resource suggestion was submitted as issue #20 and is still open. The list explicitly allows a unique use case to qualify even below its normal star threshold.

Suggested listing text if the maintainer requests a PR:

```markdown
- [Claude Code Canary](https://github.com/SLP-DEV1/claude-code-canary) - Regression testing and release bisection for Claude Code workflows and plugins.
```

### itgoyo/awesome-claude-code

Target section: **CI/CD & DevOps**.

The repository requires additions to both `README.md` and `README_CN.md` in the same PR. Its contribution guide explicitly asks contributors to fork the repository and submit a PR, so do not substitute a promotional issue for that workflow.

English row:

```markdown
| [SLP-DEV1/claude-code-canary](https://github.com/SLP-DEV1/claude-code-canary) | 1 ⭐ | Deterministic Claude Code regression tests, release bisection, plugin compatibility matrices, and CI gates |
```

Chinese row:

```markdown
| [SLP-DEV1/claude-code-canary](https://github.com/SLP-DEV1/claude-code-canary) | 1 ⭐ | 为 Claude Code 提供确定性回归测试、版本二分定位、插件兼容性矩阵和 CI 门禁 |
```

Refresh the displayed star count immediately before submitting the PR.

### hztBUAA/awesome-claude-code

Target section: **CLI Extensions and Companion Tools** (or the closest testing/automation section if the list changes before submission).

Entry format:

```markdown
- [Claude Code Canary](https://github.com/SLP-DEV1/claude-code-canary) - Deterministic regression testing, release bisection, and plugin compatibility matrices for Claude Code ![GitHub Repo stars](https://img.shields.io/github/stars/SLP-DEV1/claude-code-canary)
```

### hesreallyhim/awesome-claude-code

Do **not** submit yet. Its current rules require a resource to be at least 14 days old with continued development or have at least 100 stars, and recommendations must be submitted by a human through its web issue form. Re-check eligibility later rather than bypassing the rule.

## Repository discovery metadata

Keep the GitHub repository description focused on the problem rather than marketing language. Repository issue #53 tracks the UI-only metadata/settings changes that the GitHub connector cannot write.

Recommended topics include:

```text
claude-code
anthropic
regression-testing
compatibility-testing
version-bisect
claude-code-plugin
github-actions
continuous-integration
mcp
mcp-server
developer-tools
cli
testing
ai-agent-testing
agentic-coding
ai-agents
```

For npm discovery, keep `package.json` keywords centered on Claude Code, regression/compatibility testing, plugins, MCP, CI and agent testing. Avoid unrelated high-volume keywords.

## Post-release verification

After each public release, verify all of these before announcing it:

1. CI, CodeQL and required Live Claude E2E evidence are green on the release commit.
2. The exact `vX.Y.Z` GitHub Release exists.
3. `@v1` resolves to the intended compatible release.
4. The npm version is visible and provenance is shown when published through Trusted Publishing.
5. The consumer smoke succeeds against both the published npm package and the floating `@v1` Action from clean workspaces.
6. Marketplace status is checked separately; do not infer it merely from the existence of a GitHub Release.
7. README badges and displayed version numbers match the package/release version.
