#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error('Usage: npm run release:version -- <semver>');
  process.exit(2);
}

const packageUrl = new URL('../package.json', import.meta.url);
const lockUrl = new URL('../package-lock.json', import.meta.url);
const sourceUrl = new URL('../src/version.ts', import.meta.url);

const pkg = JSON.parse(await readFile(packageUrl, 'utf8'));
const lock = JSON.parse(await readFile(lockUrl, 'utf8'));

pkg.version = version;
lock.version = version;
if (!lock.packages || !lock.packages['']) {
  throw new Error('package-lock.json does not contain packages[""] metadata.');
}
lock.packages[''].version = version;

await writeFile(packageUrl, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
await writeFile(lockUrl, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
await writeFile(sourceUrl, `export const CANARY_VERSION = '${version}';\n`, 'utf8');

console.log(`Prepared version ${version} in package.json, package-lock.json and src/version.ts.`);
