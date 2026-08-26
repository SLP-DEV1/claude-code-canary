import { access, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getRepoRoot } from './git.js';
import {
  collectFixtureRoots,
  createReproBundle as createReproBundleCore,
  fixtureRootFromPattern,
  isDeniedFixturePath,
  type ReproBundleResult,
  type ReproOptions,
} from './repro-core.js';

export { collectFixtureRoots, fixtureRootFromPattern, isDeniedFixturePath };
export type { ReproBundleResult, ReproOptions };

const BUNDLE_MARKER = '.claude-canary-repro.json';
const HIGH_RISK_SEGMENTS = new Set(['.ssh', '.aws', '.gnupg', '.docker', '.claude']);
const HIGH_RISK_FILES = new Set([
  '.mcp.json',
  'claude.local.md',
  '.git-credentials',
  '.git-credential',
]);

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function safeSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'repro';
}

function assertSafeOutputTarget(repoRoot: string, target: string): void {
  const resolved = path.resolve(target);
  const filesystemRoot = path.parse(resolved).root;
  if (resolved === filesystemRoot) {
    throw new Error('Refusing to use a filesystem root as a reproduction bundle output directory.');
  }
  if (resolved === path.resolve(repoRoot)) {
    throw new Error('Refusing to use the repository root as a reproduction bundle output directory.');
  }
}

async function hasValidBundleMarker(target: string): Promise<boolean> {
  try {
    const raw = await readFile(path.join(target, BUNDLE_MARKER), 'utf8');
    const value = JSON.parse(raw) as { schemaVersion?: unknown; kind?: unknown };
    return value.schemaVersion === 1 && value.kind === 'claude-code-canary-repro';
  } catch {
    return false;
  }
}

function isHighRiskFinalPath(relative: string): boolean {
  const normalized = relative.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.some((part) => HIGH_RISK_SEGMENTS.has(part.toLowerCase()))) return true;
  const basename = (parts.at(-1) ?? '').toLowerCase();
  return HIGH_RISK_FILES.has(basename);
}

async function findHighRiskFixtureEntries(root: string, relative = ''): Promise<string[]> {
  const findings: string[] = [];
  if (!(await exists(root))) return findings;

  for (const entry of await readdir(root, { withFileTypes: true })) {
    const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
    if (isHighRiskFinalPath(childRelative)) {
      findings.push(childRelative);
      continue;
    }
    if (entry.isDirectory()) {
      findings.push(...await findHighRiskFixtureEntries(path.join(root, entry.name), childRelative));
    }
  }
  return findings;
}

async function readScenarioNameFromResult(repoRoot: string, resultPath: string): Promise<string | undefined> {
  try {
    const raw = await readFile(path.resolve(repoRoot, resultPath), 'utf8');
    const value = JSON.parse(raw) as { scenario?: unknown };
    return typeof value.scenario === 'string' && value.scenario.trim() ? value.scenario : undefined;
  } catch {
    return undefined;
  }
}

export async function createReproBundle(resultPath: string, options: ReproOptions = {}): Promise<ReproBundleResult> {
  const repoRoot = await getRepoRoot(options.cwd ?? process.cwd());
  const explicitTarget = options.output ? path.resolve(repoRoot, options.output) : undefined;
  if (explicitTarget) assertSafeOutputTarget(repoRoot, explicitTarget);

  const scenarioName = await readScenarioNameFromResult(repoRoot, resultPath);
  const tempBase = explicitTarget ? path.dirname(explicitTarget) : path.join(repoRoot, '.canary', 'repro');
  await mkdir(tempBase, { recursive: true });
  const tempParent = await mkdtemp(path.join(tempBase, '.cc-canary-repro-tmp-'));
  const tempBundle = path.join(tempParent, 'bundle');

  try {
    const generated = await createReproBundleCore(resultPath, {
      ...options,
      cwd: repoRoot,
      output: tempBundle,
      force: false,
    });

    const highRiskEntries = await findHighRiskFixtureEntries(path.join(tempBundle, 'fixture'));
    if (highRiskEntries.length > 0) {
      throw new Error(
        `Refusing to finalize a repro bundle containing high-risk local configuration paths: ${highRiskEntries.join(', ')}. ` +
        'Remove those paths from the scenario fixture scope or replace them with an explicitly sanitized fixture.',
      );
    }

    await writeFile(
      path.join(tempBundle, BUNDLE_MARKER),
      `${JSON.stringify({ schemaVersion: 1, kind: 'claude-code-canary-repro' }, null, 2)}\n`,
      'utf8',
    );

    const finalTarget = explicitTarget ?? path.join(
      repoRoot,
      '.canary',
      'repro',
      `${safeSlug(scenarioName ?? path.basename(generated.scenarioPath, path.extname(generated.scenarioPath)))}-${generated.baseCommit.slice(0, 8)}`,
    );
    assertSafeOutputTarget(repoRoot, finalTarget);

    if (await exists(finalTarget)) {
      if (!options.force) {
        throw new Error(`Repro output already exists: ${finalTarget}. Use --force to replace a Canary-generated bundle.`);
      }
      if (!(await hasValidBundleMarker(finalTarget))) {
        throw new Error(
          `Refusing --force because ${finalTarget} is not marked as a Claude Code Canary repro bundle. ` +
          'Choose another output directory or remove the directory manually after reviewing it.',
        );
      }
      await rm(finalTarget, { recursive: true, force: true });
    }

    await rename(tempBundle, finalTarget);
    await rm(tempParent, { recursive: true, force: true });
    return { ...generated, outputPath: finalTarget };
  } catch (error) {
    await rm(tempParent, { recursive: true, force: true });
    throw error;
  }
}
