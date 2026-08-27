# Security Policy

Claude Code Canary launches Claude Code and user-configured setup/verification commands. A disposable Git worktree isolates normal repository file changes, **not the host operating system**.

## Supported versions

| Version | Supported |
| --- | --- |
| latest `1.x` | ✅ |
| older `1.x` | best-effort security fixes when practical |
| pre-1.0 | ❌ |

Security fixes may require upgrading to the latest compatible v1 release.

## Safe usage

- Treat Canary scenarios, config variants and workflow files as trusted executable inputs.
- Do not run untrusted scenarios on a workstation that holds valuable credentials.
- Use a disposable VM/container/runner when testing untrusted repositories or plugins.
- Review Claude permission settings before enabling permissive modes such as `bypassPermissions`.
- Never commit credentials into scenario `env` blocks.
- Do not expose secret-backed GitHub Action jobs to arbitrary fork code.
- Review reproduction bundles and result artifacts before sharing them.
- Keep the Action pinned to a supported major or exact release tag rather than an arbitrary branch in production workflows.

The complete trust model is documented in [`docs/SECURITY_MODEL.md`](docs/SECURITY_MODEL.md).

## Reporting a vulnerability

Please **do not open a public issue** for a vulnerability that could enable host command execution, credential exposure, path traversal, unsafe file deletion, release-verification bypass, sandbox/isolation escape, or permission escalation.

Preferred reporting path:

1. Use GitHub's private vulnerability reporting / Security Advisory flow for this repository when the **Report a vulnerability** option is available.
2. Include the affected Canary version/commit, platform, minimal reproduction and expected impact.
3. Do not include real secrets; use test credentials/placeholders.
4. Allow coordinated disclosure until a fix/release is available.

If GitHub private vulnerability reporting is unavailable, contact the repository maintainer privately through the GitHub account rather than publishing exploit details in an issue.

## Scope notes

Canary is not an OS-level sandbox. A malicious trusted-input scenario can intentionally run shell commands with the privileges of the current user/CI runner. Reports should distinguish that documented capability from cases where untrusted data unexpectedly crosses a trust boundary.
