import { readFile, writeFile } from 'node:fs/promises';

const file = 'test/mcp-contract.test.ts';
const before = await readFile(file, 'utf8');
const needle = "    expect(defaultMcpSnapshotPath(contract, '/tmp')).toBe(path.join('/tmp', '.canary', 'mcp', 'baselines', 'safe-name.json'));\n";
const replacement = "    const root = path.resolve('tmp-mcp-contract-root');\n    expect(defaultMcpSnapshotPath(contract, root)).toBe(path.join(root, '.canary', 'mcp', 'baselines', 'safe-name.json'));\n";
if (!before.includes(needle)) throw new Error('Could not find cross-platform test patch anchor.');
await writeFile(file, before.replace(needle, replacement), 'utf8');
