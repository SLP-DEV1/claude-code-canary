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

await edit('src/index.ts', (text) => once(
  text,
  "import { formatExperiment, runExperiment } from './experiment.js';\n",
  "import { formatExperiment, runExperiment } from './experiment.js';\nimport { checkMcpContract, compareMcpContracts, formatMcpCheckMarkdown, formatMcpComparisonMarkdown, writeMcpSnapshot } from './mcp-contract.js';\n",
  'src/index.ts',
));

const commands = `program.command('mcp-snapshot')
  .description('Capture a deterministic compatibility snapshot from a stdio MCP server')
  .argument('[contract]', 'MCP contract YAML', '.canary/mcp/server.mcp.yml')
  .option('-o, --output <path>', 'snapshot JSON path (default: .canary/mcp/baselines/<name>.json)')
  .option('--json', 'print snapshot metadata as JSON', false)
  .action(async (contractPath: string, options: { output?: string; json: boolean }) => {
    const result = await writeMcpSnapshot(contractPath, { cwd: process.cwd(), output: options.output });
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log('Claude Code Canary — MCP snapshot\\n');
      console.log('Contract: ' + result.snapshot.contract);
      console.log('Protocol: ' + result.snapshot.protocolVersion);
      console.log('Tools: ' + result.snapshot.tools.length);
      console.log('Prompts: ' + result.snapshot.prompts.length);
      console.log('Resources: ' + result.snapshot.resources.length);
      console.log('Fingerprint: ' + result.snapshot.fingerprint);
      console.log('Snapshot: ' + result.path);
    }
  });

program.command('mcp-check')
  .description('Check a live stdio MCP server against expectations and an optional committed baseline')
  .argument('[contract]', 'MCP contract YAML', '.canary/mcp/server.mcp.yml')
  .option('--baseline <path>', 'specific baseline snapshot JSON')
  .option('--require-baseline', 'fail when no baseline snapshot exists', false)
  .option('--save-snapshot <path>', 'also save the current live snapshot to this path')
  .option('--json', 'print JSON instead of Markdown', false)
  .action(async (contractPath: string, options: { baseline?: string; requireBaseline: boolean; saveSnapshot?: string; json: boolean }) => {
    const result = await checkMcpContract(contractPath, {
      cwd: process.cwd(),
      baseline: options.baseline,
      requireBaseline: options.requireBaseline,
      saveSnapshot: options.saveSnapshot,
    });
    console.log(options.json ? JSON.stringify(result, null, 2) : formatMcpCheckMarkdown(result));
    if (!result.passed) process.exitCode = 1;
  });

program.command('mcp-compare')
  .description('Compare the compatibility surfaces of two live stdio MCP server contracts')
  .argument('<baseline-contract>', 'baseline MCP contract YAML')
  .argument('<candidate-contract>', 'candidate MCP contract YAML')
  .option('--json', 'print JSON instead of Markdown', false)
  .action(async (baselineContract: string, candidateContract: string, options: { json: boolean }) => {
    const result = await compareMcpContracts(baselineContract, candidateContract, { cwd: process.cwd() });
    console.log(options.json ? JSON.stringify(result, null, 2) : formatMcpComparisonMarkdown(result));
    if (!result.passed) process.exitCode = 1;
  });

`;

await edit('src/index.ts', (text) => once(
  text,
  "program.command('experiment')\n",
  commands + "program.command('experiment')\n",
  'src/index.ts',
));

await edit('README.md', (text) => {
  let out = once(
    text,
    '  <a href="docs/PLUGIN_SUITE.md">Plugin suites</a> ·\n',
    '  <a href="docs/PLUGIN_SUITE.md">Plugin suites</a> ·\n  <a href="docs/MCP_CONTRACTS.md">MCP contracts</a> ·\n',
    'README.md',
  );
  out = once(
    out,
    '| "Can CI do this without paying for two runs every time?" | Commit a known-good metric baseline and execute only the candidate. |\n',
    '| "Can CI do this without paying for two runs every time?" | Commit a known-good metric baseline and execute only the candidate. |\n| "Did my MCP server silently change?" | Snapshot tools/prompts/resources and fail on removed tools, schema changes or capability regressions. |\n',
    'README.md',
  );
  const section = `### Check an MCP server contract

Inspect a stdio MCP server directly, without invoking a model:

\`\`\`bash
claude-canary mcp-snapshot .canary/mcp/github.mcp.yml
# review + commit the generated baseline
claude-canary mcp-check .canary/mcp/github.mcp.yml --require-baseline
\`\`\`

Canary snapshots tools and JSON Schemas, prompts, resources, resource templates, capabilities and observed \`list_changed\` signals. Removed tools, schema changes and disabled capabilities are breaking by default; additions are reported without failing CI. Tool safety annotations can also be asserted without executing the tool. See [MCP contract testing](docs/MCP_CONTRACTS.md).

`;
  return once(out, '### Gate a pull request\n', section + '### Gate a pull request\n', 'README.md');
});

await edit('CHANGELOG.md', (text) => once(
  text,
  '## [Unreleased]\n',
  '## [Unreleased]\n\n### Added\n\n- add protocol-native stdio MCP contract snapshots and checks for tools, JSON schemas, prompts, resources, resource templates and capabilities\n- add `mcp-snapshot`, `mcp-check` and `mcp-compare` with paginated discovery, fingerprinted baselines, tool-safety annotation assertions and breaking/non-breaking contract reports\n',
  'CHANGELOG.md',
));

await edit('ROADMAP.md', (text) => once(
  text,
  '### P0 — MCP contract testing\n',
  '### P0 — MCP contract testing *(in progress)*\n',
  'ROADMAP.md',
));
