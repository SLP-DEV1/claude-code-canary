# Security

Claude Code Canary launches Claude Code and user-configured setup/verification commands. A disposable Git worktree isolates repository file changes, **not the host operating system**.

## Safe usage

- Do not run untrusted Canary scenarios on your workstation.
- Use a container or VM for untrusted repositories or prompts.
- Review permission settings before using `bypassPermissions`.
- Never commit credentials into scenario `env` blocks.
- Treat generated result artifacts as potentially sensitive metadata before sharing them.

## Reporting a vulnerability

Please avoid opening a public issue for a vulnerability that could lead to host command execution, credential exposure, sandbox escape, or unsafe permission escalation. Contact the repository owner privately through GitHub where possible, then coordinate disclosure.
