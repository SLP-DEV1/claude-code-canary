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

await edit('src/mcp-contract.ts', (text) => {
  const anchor = `  const beforeCapabilities = flattenBooleanCapabilities(baseline.capabilities);
  const afterCapabilities = flattenBooleanCapabilities(candidate.capabilities);
`;
  const replacement = `  const beforeTopCapabilities = new Set(Object.keys(baseline.capabilities));
  const afterTopCapabilities = new Set(Object.keys(candidate.capabilities));
  for (const name of beforeTopCapabilities) {
    if (!afterTopCapabilities.has(name)) breakingChanges.push(\`capabilities: \${name} was removed.\`);
  }
  for (const name of afterTopCapabilities) {
    if (!beforeTopCapabilities.has(name)) nonBreakingChanges.push(\`capabilities: \${name} was added.\`);
  }

  const beforeCapabilities = flattenBooleanCapabilities(baseline.capabilities);
  const afterCapabilities = flattenBooleanCapabilities(candidate.capabilities);
`;
  let out = once(text, anchor, replacement, 'src/mcp-contract.ts');
  out = once(
    out,
    `  for (const [name, value] of beforeCapabilities) {
    const current = afterCapabilities.get(name);
    if (value === true && current !== true) breakingChanges.push(\`capabilities: \${name} was removed or disabled.\`);
  }
  for (const [name, value] of afterCapabilities) {
    if (value === true && beforeCapabilities.get(name) !== true) nonBreakingChanges.push(\`capabilities: \${name} was added or enabled.\`);
  }
`,
    `  for (const [name, value] of beforeCapabilities) {
    const root = name.split('.', 1)[0];
    if (!afterTopCapabilities.has(root)) continue;
    const current = afterCapabilities.get(name);
    if (value === true && current !== true) breakingChanges.push(\`capabilities: \${name} was removed or disabled.\`);
  }
  for (const [name, value] of afterCapabilities) {
    const root = name.split('.', 1)[0];
    if (!beforeTopCapabilities.has(root)) continue;
    if (value === true && beforeCapabilities.get(name) !== true) nonBreakingChanges.push(\`capabilities: \${name} was added or enabled.\`);
  }
`,
    'src/mcp-contract.ts',
  );
  return out;
});

await edit('test/mcp-contract.test.ts', (text) => {
  const anchor = `      expect(comparison.nonBreakingChanges.join('\\n')).toContain('tools: added new_tool');
`;
  const replacement = `${anchor}
      const withoutToolsCapability: McpContractSnapshot = {
        ...baseline,
        capabilities: Object.fromEntries(Object.entries(baseline.capabilities).filter(([name]) => name !== 'tools')),
      };
      const capabilityComparison = compareMcpSnapshots(baseline, withoutToolsCapability);
      expect(capabilityComparison.breakingChanges.join('\\n')).toContain('capabilities: tools was removed');
`;
  return once(text, anchor, replacement, 'test/mcp-contract.test.ts');
});

await edit('docs/MCP_CONTRACTS.md', (text) => {
  let out = once(
    text,
    'The distinction keeps additive server growth from failing CI while still surfacing it in the report.\n',
    'The distinction keeps additive server growth from failing CI while still surfacing it in the report. Removing an entire advertised top-level capability is breaking even when that capability had no boolean sub-flags.\n',
    'docs/MCP_CONTRACTS.md',
  );
  out = once(
    out,
    'Commit the `.mcp.yml` file and its reviewed baseline. Do not commit credentials into the contract; reference only non-secret test-mode environment values and inject real secrets through the CI environment if the server truly needs them.\n',
    'Commit the `.mcp.yml` file and its reviewed baseline. Do not commit credentials into the contract; reference only non-secret test-mode environment values and inject real secrets through the CI environment if the server truly needs them.\n\nAn MCP contract can launch an arbitrary local command. Treat contract files and the referenced server code as executable trusted CI input, just like Canary scenarios and build scripts. Do not run untrusted fork contracts with privileged environment credentials.\n',
    'docs/MCP_CONTRACTS.md',
  );
  return out;
});

await edit('ROADMAP.md', (text) => once(
  text,
  '### P0 — MCP contract testing *(in progress)*\n',
  '### P0 — MCP contract testing *(implemented for v1.2)*\n',
  'ROADMAP.md',
));
