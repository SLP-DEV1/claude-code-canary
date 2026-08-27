import { readFile, writeFile } from 'node:fs/promises';

async function edit(file, transform) {
  const before = await readFile(file, 'utf8');
  const after = transform(before);
  if (after === before) throw new Error(`Patch made no change to ${file}`);
  await writeFile(file, after, 'utf8');
}

function once(text, needle, replacement, file) {
  const first = text.indexOf(needle);
  if (first < 0) throw new Error(`Could not find patch anchor in ${file}: ${needle.slice(0, 100)}`);
  if (text.indexOf(needle, first + needle.length) >= 0) throw new Error(`Patch anchor is ambiguous in ${file}`);
  return text.slice(0, first) + replacement + text.slice(first + needle.length);
}

await edit('src/mcp-contract.ts', (text) => once(
  text,
  `      if (message.id !== undefined) {
        this.write({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not supported by Canary contract inspector' } });
      }
`,
  `      if (message.id !== undefined) {
        if (message.method === 'ping') this.write({ jsonrpc: '2.0', id: message.id, result: {} });
        else this.write({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not supported by Canary contract inspector' } });
      }
`,
  'src/mcp-contract.ts',
));

await edit('README.md', (text) => once(
  text,
  'The v1 Action supports `compare`, `run`, `pr-check`, `baseline-check`, `plugin-matrix` and `plugin-suite` through one Marketplace-ready `action.yml`.',
  'The v1 Action supports `compare`, `run`, `pr-check`, `baseline-check`, `mcp-check`, `plugin-matrix` and `plugin-suite` through one Marketplace-ready `action.yml`.',
  'README.md',
));

await edit('docs/GITHUB_ACTION.md', (text) => {
  let out = once(
    text,
    'Claude Canary exposes one composite Action for deterministic release comparisons, pull-request regression gates, committed-baseline checks and plugin compatibility suites.',
    'Claude Canary exposes one composite Action for deterministic release comparisons, pull-request regression gates, MCP contract checks, committed-baseline checks and plugin compatibility suites.',
    'docs/GITHUB_ACTION.md',
  );
  out = once(
    out,
    'For the current exact immutable v1 patch release use `@v1.0.1` instead of the moving `@v1` compatibility tag.',
    'For the current exact immutable v1 patch release use `@v1.1.0` instead of the moving `@v1` compatibility tag.',
    'docs/GITHUB_ACTION.md',
  );
  out = once(
    out,
    '`pr-check`, `baseline-check`, `plugin-matrix` and `plugin-suite` create Markdown reports.',
    '`pr-check`, `baseline-check`, `plugin-matrix` and `plugin-suite` create report artifacts. `mcp-check` writes its bounded Markdown contract report directly into the Step Summary through the Action runner.',
    'docs/GITHUB_ACTION.md',
  );
  return out;
});
