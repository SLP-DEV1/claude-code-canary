# Plugin smoke generator

`claude-canary plugin-init` turns a Claude Code plugin directory into a reviewable set of Canary smoke scenarios.

```bash
claude-canary plugin-init ./my-plugin
```

By default the generated suite is written to:

```text
.canary/plugins/<plugin-name>/
├── .claude-canary-plugin-init
├── README.md
├── discovery.json
├── load.canary.yml
├── command-*.canary.yml
├── agent-*.canary.yml
├── skill-*.canary.yml
├── hook-*.canary.yml
└── mcp-*.canary.yml
```

## What is discovered

Canary follows Claude Code's plugin layout and manifest rules rather than assuming every plugin uses only the default folders.

It reads `.claude-plugin/plugin.json`, then discovers:

- commands from `commands/` plus manifest `commands` paths
- agents from `agents/` plus manifest `agents` paths
- skills from `skills/<skill>/SKILL.md`
- hooks from `hooks/hooks.json` plus manifest `hooks` path or inline configuration
- MCP servers from `.mcp.json` plus manifest `mcpServers` path or inline configuration

Command names come from their Markdown filenames, matching Claude Code's slash-command semantics; command frontmatter contributes metadata such as `description`. Agent and skill names/descriptions use frontmatter where supported and fall back to their filenames/directories.

Custom manifest paths must follow Claude Code's portable plugin rules: they must start with `./`, remain inside the plugin root, use forward slashes and must not contain `..` traversal.

If the same MCP server name is defined by two different plugin sources, Canary fails discovery instead of silently choosing one. This mirrors Claude Code's conflict-oriented plugin loading model and keeps generated suites deterministic.

## Generated scenarios

Every suite contains a plugin-load scenario plus one scenario for every discovered component.

Command scenarios ask Claude Code to invoke the namespaced plugin slash command with a harmless read-only request. Agent and skill scenarios use small read-only tasks designed to exercise discovery/activation. Hook scenarios enable hook-event streaming and create a harmless session in which the hook can load or fire when applicable. MCP scenarios ask for connection/tool discovery and only permit clearly read-only operations.

Generated scenarios deny repository changes by default:

```yaml
expect:
  changed_files:
    allow: []
    require: []
    deny:
      - "**"
```

They are deliberately conservative starting points. Plugin behavior varies, especially for commands that require specific arguments, hooks with narrow tool matchers, and MCP servers whose useful smoke operation is domain-specific. Review the generated prompt before making it a release gate.

## Run against Claude Code releases

Generate the suite once:

```bash
claude-canary plugin-init ./my-plugin
```

Then run any generated scenario through the compatibility matrix:

```bash
claude-canary plugin-matrix \
  .canary/plugins/my-plugin/load.canary.yml \
  --plugin ./my-plugin \
  --last 10
```

For a command-specific check:

```bash
claude-canary plugin-matrix \
  .canary/plugins/my-plugin/command-review.canary.yml \
  --plugin ./my-plugin \
  --from 2.1.220 \
  --to 2.1.237
```

## Discovery metadata

`discovery.json` records what Canary found without copying plugin file contents. It includes component names, source paths, whether each component came from a default location or manifest configuration, and discovery warnings such as duplicate component names.

This makes the generated suite auditable and lets CI/tooling inspect the plugin surface without parsing the plugin again.

## Safe replacement

Regenerate a suite with:

```bash
claude-canary plugin-init ./my-plugin --force
```

`--force` only replaces a directory that contains Canary's `.claude-canary-plugin-init` marker. Canary refuses to recursively delete an arbitrary directory merely because it matches `--output`.

Use a custom destination with:

```bash
claude-canary plugin-init ./my-plugin --output .canary/custom-plugin-suite
```

## Isolation and symlinks

`plugin-init` refuses plugin trees containing symlinks. `plugin-matrix` has the same fail-closed rule before it copies the plugin into a fresh temporary directory for each release run.

This prevents a generated or matrix-tested plugin tree from escaping isolation through a link back to external files.

## JSON output

For scripts and CI setup:

```bash
claude-canary plugin-init ./my-plugin --json
```

The command prints generated paths plus the discovery result as JSON.

## Current limitations

The generator can discover plugin structure deterministically, but it cannot infer perfect semantic test inputs for every third-party component. In particular:

- commands may require domain-specific arguments
- skills are selected by Claude based on task relevance
- agents may require particular context to trigger correctly
- hook matchers may only fire on operations that a read-only smoke test intentionally avoids
- MCP servers can expose arbitrary tools, authentication requirements and side effects

Treat generated YAML as a strong scaffold, then tighten prompts and deterministic assertions for the plugin's real contract.
