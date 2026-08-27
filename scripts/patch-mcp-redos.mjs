import { readFile, writeFile } from 'node:fs/promises';

async function edit(file, transform) {
  const before = await readFile(file, 'utf8');
  const after = transform(before);
  if (after === before) throw new Error(`Patch made no change to ${file}`);
  await writeFile(file, after, 'utf8');
}

function once(text, needle, replacement, file) {
  const first = text.indexOf(needle);
  if (first < 0) throw new Error(`Could not find patch anchor in ${file}`);
  if (text.indexOf(needle, first + needle.length) >= 0) throw new Error(`Patch anchor is ambiguous in ${file}`);
  return text.slice(0, first) + replacement + text.slice(first + needle.length);
}

await edit('src/mcp-contract.ts', (text) => once(
  text,
  "function slug(value: string): string {\n  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'mcp';\n}\n",
  "function slug(value: string): string {\n  const normalized = value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-');\n  const withoutLeading = normalized.replace(/^-+/, '');\n  const withoutTrailing = withoutLeading.replace(/-+$/, '');\n  return withoutTrailing.slice(0, 80) || 'mcp';\n}\n",
  'src/mcp-contract.ts',
));

await edit('test/mcp-contract.test.ts', (text) => {
  const importAnchor = "  compareMcpSnapshots,\n";
  let out = once(text, importAnchor, "  compareMcpSnapshots,\n  defaultMcpSnapshotPath,\n", 'test/mcp-contract.test.ts');
  const testAnchor = "  it('writes fingerprinted snapshots and rejects tampering', async () => {\n";
  const test = `  it('normalizes adversarially long contract names without polynomial edge trimming', () => {\n    const contract = McpContractSchema.parse({\n      version: 1,\n      name: \`${'-'.repeat(50_000)}safe-name${'-'.repeat(50_000)}\`,\n      server: { command: process.execPath },\n    });\n    expect(defaultMcpSnapshotPath(contract, '/tmp')).toBe(path.join('/tmp', '.canary', 'mcp', 'baselines', 'safe-name.json'));\n  });\n\n`;
  out = once(out, testAnchor, test + testAnchor, 'test/mcp-contract.test.ts');
  return out;
});
