# Contributing to Claude Code Canary

Thanks for helping make Claude Code regressions reproducible.

## Development

```bash
git clone https://github.com/SLP-DEV1/claude-code-canary.git
cd claude-code-canary
npm install
npm test
npm run build
```

Node.js 20+ is required.

## Pull requests

- Keep changes focused.
- Add tests for parser, evaluator and reporter behavior where practical.
- Do not add behavior that silently enables `bypassPermissions`.
- Avoid depending on undocumented terminal rendering. Prefer documented Claude Code CLI/JSON interfaces.
- Keep result artifacts free of raw prompts/model output unless an explicit future opt-in redaction design covers it.
- Update `schemas/canary.schema.json` when the scenario format changes.

## Good first contributions

- richer deterministic assertions
- Windows/macOS worktree edge-case tests
- stream-json fixtures from different Claude Code releases
- reporters (JUnit/SARIF/Markdown)
- version discovery and cache design
- hook-event compatibility fixtures

## Bug reports

Please include your OS, Node version, Claude Code version, the smallest scenario that reproduces the problem, and the Canary JSON result if it contains no sensitive information.
