import { readFile, writeFile } from 'node:fs/promises';

async function edit(file, transform) {
  const before = await readFile(file, 'utf8');
  const after = transform(before);
  if (after === before) throw new Error(`Patch made no change to ${file}`);
  await writeFile(file, after, 'utf8');
}

function once(text, needle, replacement, file) {
  const first = text.indexOf(needle);
  if (first < 0) throw new Error(`Could not find patch anchor in ${file}: ${needle.slice(0, 80)}`);
  if (text.indexOf(needle, first + needle.length) >= 0) throw new Error(`Patch anchor is ambiguous in ${file}`);
  return text.slice(0, first) + replacement + text.slice(first + needle.length);
}

await edit('scripts/action-runner.mjs', (text) => {
  let out = once(
    text,
    "const MODES = new Set(['compare', 'run', 'pr-check', 'baseline-check', 'plugin-matrix', 'plugin-suite']);",
    "const MODES = new Set(['compare', 'run', 'pr-check', 'baseline-check', 'mcp-check', 'plugin-matrix', 'plugin-suite']);",
    'scripts/action-runner.mjs',
  );
  const mcpCase = `    case 'mcp-check': {
      const args = ['mcp-check', config.mcpContract || '.canary/mcp/server.mcp.yml'];
      if (config.baseline) args.push('--baseline', config.baseline);
      if (config.mcpRequireBaseline) args.push('--require-baseline');
      return args;
    }
`;
  out = once(out, "    case 'plugin-matrix': {\n", mcpCase + "    case 'plugin-matrix': {\n", 'scripts/action-runner.mjs');
  out = once(
    out,
    "    baseline: env('CANARY_BASELINE'),\n",
    "    baseline: env('CANARY_BASELINE'),\n    mcpContract: env('CANARY_MCP_CONTRACT'),\n    mcpRequireBaseline: parseBoolean(env('CANARY_MCP_REQUIRE_BASELINE', 'true'), 'mcp-require-baseline'),\n",
    'scripts/action-runner.mjs',
  );
  return out;
});

await edit('action.yml', (text) => {
  let out = once(
    text,
    'description: Regression-test Claude Code releases, pull requests, committed baselines, plugins and configs with deterministic scenarios.\n',
    'description: Regression-test Claude Code releases, pull requests, MCP contracts, committed baselines, plugins and configs with deterministic scenarios.\n',
    'action.yml',
  );
  out = once(
    out,
    '    description: "Canary workflow: compare, run, pr-check, baseline-check, plugin-matrix, or plugin-suite."\n',
    '    description: "Canary workflow: compare, run, pr-check, baseline-check, mcp-check, plugin-matrix, or plugin-suite."\n',
    'action.yml',
  );
  const inputs = `  mcp-contract:
    description: MCP contract YAML for mcp-check. Defaults to .canary/mcp/server.mcp.yml.
    required: false
    default: ""
  mcp-require-baseline:
    description: Require a committed MCP baseline when mode=mcp-check.
    required: false
    default: "true"
`;
  out = once(out, '  comment-pr:\n', inputs + '  comment-pr:\n', 'action.yml');
  out = once(
    out,
    '        CANARY_BASELINE: ${{ inputs.baseline }}\n',
    '        CANARY_BASELINE: ${{ inputs.baseline }}\n        CANARY_MCP_CONTRACT: ${{ inputs.mcp-contract }}\n        CANARY_MCP_REQUIRE_BASELINE: ${{ inputs.mcp-require-baseline }}\n',
    'action.yml',
  );
  return out;
});

await edit('test/action-runner.test.ts', (text) => {
  const test = `
  it('builds a side-effect-free MCP contract gate', () => {
    expect(buildCliArgs({
      mode: 'mcp-check', mcpContract: '.canary/mcp/github.mcp.yml', baseline: '.canary/mcp/baselines/github.json', mcpRequireBaseline: true,
    })).toEqual([
      'mcp-check', '.canary/mcp/github.mcp.yml', '--baseline', '.canary/mcp/baselines/github.json', '--require-baseline',
    ]);
  });
`;
  return once(text, "  it('hydrates exact pull request SHAs from the GitHub event payload', async () => {\n", test + "\n  it('hydrates exact pull request SHAs from the GitHub event payload', async () => {\n", 'test/action-runner.test.ts');
});

await edit('test/action.test.ts', (text) => once(
  text,
  "    expect(action.inputs?.baseline?.default).toBe('');\n",
  "    expect(action.inputs?.baseline?.default).toBe('');\n    expect(action.inputs?.['mcp-contract']?.default).toBe('');\n    expect(action.inputs?.['mcp-require-baseline']?.default).toBe('true');\n",
  'test/action.test.ts',
));

await edit('docs/GITHUB_ACTION.md', (text) => {
  let out = once(text, '- `baseline-check`\n', '- `baseline-check`\n- `mcp-check`\n', 'docs/GITHUB_ACTION.md');
  const section = `## MCP contract gate

MCP contract checks do not require Claude or a model credential. They initialize the configured stdio MCP server directly and compare its exposed protocol surface with explicit expectations and, by default, a committed known-good snapshot.

\`\`\`yaml
- uses: SLP-DEV1/claude-code-canary@v1
  with:
    mode: mcp-check
    mcp-contract: .canary/mcp/github.mcp.yml
    mcp-require-baseline: true
\`\`\`

The optional shared \`baseline\` input selects a non-default MCP snapshot path in this mode. See [MCP contract testing](MCP_CONTRACTS.md).

`;
  out = once(out, '## Plugin suite quick start\n', section + '## Plugin suite quick start\n', 'docs/GITHUB_ACTION.md');
  out = once(
    out,
    '| `mode` | `compare` | all | `compare`, `run`, `pr-check`, `baseline-check`, `plugin-matrix`, or `plugin-suite` |\n',
    '| `mode` | `compare` | all | `compare`, `run`, `pr-check`, `baseline-check`, `mcp-check`, `plugin-matrix`, or `plugin-suite` |\n',
    'docs/GITHUB_ACTION.md',
  );
  out = once(
    out,
    '| `baseline` | generated default | baseline-check | Optional committed baseline JSON path |\n',
    '| `baseline` | generated default | baseline-check/mcp-check | Optional committed baseline JSON path |\n| `mcp-contract` | `.canary/mcp/server.mcp.yml` | mcp-check | MCP contract YAML path |\n| `mcp-require-baseline` | `true` | mcp-check | Fail when no reviewed MCP baseline exists |\n',
    'docs/GITHUB_ACTION.md',
  );
  return out;
});

const schema = JSON.parse(await readFile('schemas/mcp-contract.schema.json', 'utf8'));
schema.$defs.toolExpectations = {
  type: 'object',
  additionalProperties: false,
  properties: {
    require: { type: 'array', items: { type: 'string', minLength: 1 }, default: [] },
    deny: { type: 'array', items: { type: 'string', minLength: 1 }, default: [] },
    exact: { type: 'boolean', default: false },
    require_read_only: { type: 'array', items: { type: 'string', minLength: 1 }, default: [] },
    deny_destructive: { type: 'boolean', default: false },
  },
};
await writeFile('schemas/mcp-contract.schema.json', `${JSON.stringify(schema, null, 2)}\n`, 'utf8');
