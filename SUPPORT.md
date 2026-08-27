# Support

Claude Code Canary is maintained as an open-source regression-testing tool. The fastest path to a useful answer depends on the kind of problem you have.

## Usage and setup

Start with the [README](README.md) and the guides in [`docs/`](docs/). Run `claude-canary doctor` when the problem may be caused by the local Claude Code, plugin, MCP or provider environment.

## Bugs

Use the repository's **Bug report** issue form for reproducible Canary defects. Include the Canary version, Claude Code version, Node.js version, operating system, the smallest reproduction and only the relevant redacted output.

Before posting a `.canary/results/` artifact or log, remove API keys, tokens, private prompts, local paths, personal data and confidential project content.

## Feature requests

Use the **Feature request** issue form for regression-testing, compatibility, reporting or CI workflows that fit Canary's scope. A concrete example of the desired CLI, Action input, API or scenario syntax is especially useful.

## Security vulnerabilities

Do **not** open a public issue for a vulnerability. Follow [SECURITY.md](SECURITY.md) and use the repository's private security reporting path.

## Claude Code or provider problems

If the same failure occurs without Canary when invoking the underlying `claude` executable directly, the problem may belong to Claude Code, the configured gateway or provider rather than this repository. A minimal direct reproduction helps separate those layers before filing a Canary issue.
