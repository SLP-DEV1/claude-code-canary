#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
const versionSource = await readFile(new URL('../src/version.ts', import.meta.url), 'utf8');
const sourceMatch = versionSource.match(/CANARY_VERSION\s*=\s*['"]([^'"]+)['"]/);

if (!sourceMatch) {
  throw new Error('Could not read CANARY_VERSION from src/version.ts.');
}

const versions = {
  'package.json': pkg.version,
  'package-lock.json': lock.version,
  'package-lock.json packages[""]': lock.packages?.['']?.version,
  'src/version.ts': sourceMatch[1],
};

for (const [name, version] of Object.entries(versions)) {
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`${name} has an invalid version: ${String(version)}`);
  }
}

const unique = new Set(Object.values(versions));
if (unique.size !== 1) {
  const details = Object.entries(versions).map(([name, version]) => `${name}=${version}`).join(', ');
  throw new Error(`Version metadata is out of sync: ${details}`);
}

console.log(`Version metadata is synchronized at ${pkg.version}.`);
