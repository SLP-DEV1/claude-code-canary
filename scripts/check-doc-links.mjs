import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const excludedDirectories = new Set([
  '.git',
  '.canary',
  'coverage',
  'dist',
  'node_modules',
]);

async function collectMarkdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;

    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name)) {
        files.push(...await collectMarkdownFiles(absolute));
      }
      continue;
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      files.push(absolute);
    }
  }

  return files;
}

function preserveLinesAsSpaces(value) {
  return value.replace(/[^\n]/g, ' ');
}

function stripCode(content) {
  return content
    .replace(/(^|\n)(```|~~~)[^\n]*\n[\s\S]*?\n\2(?=\n|$)/g, preserveLinesAsSpaces)
    .replace(/`[^`\n]*`/g, preserveLinesAsSpaces);
}

function lineNumber(content, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (content.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function shouldIgnore(target) {
  const value = target.trim();
  if (!value || value.startsWith('#') || value.startsWith('//') || value.startsWith('/')) {
    return true;
  }
  if (value.includes('${{') || value.includes('{{')) return true;
  return /^[a-z][a-z0-9+.-]*:/i.test(value);
}

function normalizeTarget(rawTarget) {
  let target = rawTarget.trim();

  if (target.startsWith('<') && target.endsWith('>')) {
    target = target.slice(1, -1);
  }

  target = target.split('#', 1)[0].split('?', 1)[0];
  if (!target) return null;

  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

function extractTargets(content) {
  const targets = [];
  const patterns = [
    /!?\[[^\]\n]*\]\(([^)\n]+)\)/g,
    /^\s*\[[^\]\n]+\]:\s*(\S+)/gm,
    /\b(?:href|src)\s*=\s*["']([^"']+)["']/gi,
  ];

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      let target = match[1].trim();

      // Markdown destinations may include an optional quoted title. For the
      // common no-whitespace path form, keep only the destination token.
      if (!target.startsWith('<')) {
        target = target.split(/\s+["']/u, 1)[0];
      }

      targets.push({ target, index: match.index ?? 0 });
    }
  }

  return targets;
}

const markdownFiles = await collectMarkdownFiles(root);
const failures = [];
let checkedLinks = 0;

for (const absoluteFile of markdownFiles) {
  const raw = await readFile(absoluteFile, 'utf8');
  const searchable = stripCode(raw);
  const relativeFile = path.relative(root, absoluteFile).split(path.sep).join('/');

  for (const { target: rawTarget, index } of extractTargets(searchable)) {
    if (shouldIgnore(rawTarget)) continue;

    const target = normalizeTarget(rawTarget);
    if (!target) continue;

    checkedLinks += 1;
    const resolved = path.resolve(path.dirname(absoluteFile), target);
    const relativeResolved = path.relative(root, resolved);

    if (relativeResolved.startsWith('..') || path.isAbsolute(relativeResolved)) {
      failures.push({
        file: relativeFile,
        line: lineNumber(searchable, index),
        target: rawTarget,
        reason: 'resolves outside the repository',
      });
      continue;
    }

    if (!existsSync(resolved)) {
      failures.push({
        file: relativeFile,
        line: lineNumber(searchable, index),
        target: rawTarget,
        reason: 'target does not exist',
      });
    }
  }
}

if (failures.length > 0) {
  console.error(`Documentation link check failed with ${failures.length} broken local link(s):`);
  for (const failure of failures) {
    console.error(`- ${failure.file}:${failure.line} -> ${failure.target} (${failure.reason})`);
  }
  process.exitCode = 1;
} else {
  console.log(`Documentation link check passed: ${markdownFiles.length} Markdown files, ${checkedLinks} local links checked.`);
}
