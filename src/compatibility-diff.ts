import {
  loadCanaryLock,
  loadCompatibilityManifest,
  type CanaryLock,
  type CompatibilityManifest,
} from './compatibility.js';

export type CompatibilityDiffImpact = 'none' | 'informational' | 'evidence' | 'compatibility' | 'regression';
export type CompatibilityDiffKind = 'lock' | 'manifest';

export interface CompatibilityDiffChange {
  path: string;
  kind:
    | 'tooling'
    | 'release'
    | 'platform'
    | 'component-added'
    | 'component-removed'
    | 'component-version'
    | 'suite-definition'
    | 'evidence'
    | 'result'
    | 'failure-fingerprints'
    | 'metadata';
  impact: Exclude<CompatibilityDiffImpact, 'none'>;
  component?: string;
  before?: unknown;
  after?: unknown;
  explanation: string;
}

export interface CompatibilityDiffResult {
  schemaVersion: 1;
  kind: CompatibilityDiffKind;
  changed: boolean;
  impact: CompatibilityDiffImpact;
  summary: string;
  ignoredFields: string[];
  changes: CompatibilityDiffChange[];
}

const IMPACT_RANK: Record<CompatibilityDiffImpact, number> = {
  none: 0,
  informational: 1,
  evidence: 2,
  compatibility: 3,
  regression: 4,
};

function highestImpact(changes: CompatibilityDiffChange[]): CompatibilityDiffImpact {
  let impact: CompatibilityDiffImpact = 'none';
  for (const change of changes) {
    if (IMPACT_RANK[change.impact] > IMPACT_RANK[impact]) impact = change.impact;
  }
  return impact;
}

function componentLabel(component: string, version?: string): string {
  return `${component}${version ? `@${version}` : ''}`;
}

function resultFor(kind: CompatibilityDiffKind, changes: CompatibilityDiffChange[], ignoredFields: string[]): CompatibilityDiffResult {
  const impact = highestImpact(changes);
  const changed = changes.length > 0;
  const noun = changes.length === 1 ? 'semantic change' : 'semantic changes';
  const summary = changed
    ? `${changes.length} ${noun}; highest impact: ${impact}.`
    : `No semantic differences. Ignored volatile field${ignoredFields.length === 1 ? '' : 's'}: ${ignoredFields.join(', ')}.`;
  return { schemaVersion: 1, kind, changed, impact, summary, ignoredFields, changes };
}

function releaseExplanation(before: string, after: string): string {
  const a = before.split('.').map(Number);
  const b = after.split('.').map(Number);
  const direction = b.some((value, index) => value !== a[index])
    ? (b[0] > a[0] || (b[0] === a[0] && (b[1] > a[1] || (b[1] === a[1] && b[2] > a[2]))) ? 'upgraded' : 'downgraded')
    : 'changed';
  return `Claude Code ${direction} from ${before} to ${after}; compatibility evidence should be re-evaluated for the new release.`;
}

function groupLockSuites(lock: CanaryLock): Map<string, CanaryLock['suites']> {
  const groups = new Map<string, CanaryLock['suites']>();
  for (const suite of lock.suites) {
    const group = groups.get(suite.component) ?? [];
    group.push(suite);
    groups.set(suite.component, group);
  }
  for (const group of groups.values()) group.sort((a, b) => (a.componentVersion ?? '').localeCompare(b.componentVersion ?? ''));
  return groups;
}

function compareSuiteHashes(
  component: string,
  before: CanaryLock['suites'][number],
  after: CanaryLock['suites'][number],
  changes: CompatibilityDiffChange[],
): void {
  const label = componentLabel(component, after.componentVersion ?? before.componentVersion);
  if (before.suiteHash !== after.suiteHash) {
    changes.push({
      path: `suites.${label}.suiteHash`,
      kind: 'suite-definition',
      impact: 'compatibility',
      component,
      before: before.suiteHash,
      after: after.suiteHash,
      explanation: `${label} uses a different suite definition; this is not just a rerun and may change what behavior is covered.`,
    });
  }
  if (before.evidenceHash !== after.evidenceHash) {
    changes.push({
      path: `suites.${label}.evidenceHash`,
      kind: 'evidence',
      impact: 'evidence',
      component,
      before: before.evidenceHash,
      after: after.evidenceHash,
      explanation: `${label} has different evidence with the same component identity; the underlying test evidence was regenerated or changed.`,
    });
  }
}

export function diffCanaryLocks(before: CanaryLock, after: CanaryLock): CompatibilityDiffResult {
  const changes: CompatibilityDiffChange[] = [];

  if (before.canaryVersion !== after.canaryVersion) {
    changes.push({
      path: 'canaryVersion',
      kind: 'tooling',
      impact: 'informational',
      before: before.canaryVersion,
      after: after.canaryVersion,
      explanation: `Canary tooling changed from ${before.canaryVersion} to ${after.canaryVersion}; lock semantics may have been produced by a different Canary release.`,
    });
  }
  if (before.claudeCode !== after.claudeCode) {
    changes.push({
      path: 'claudeCode',
      kind: 'release',
      impact: 'compatibility',
      before: before.claudeCode,
      after: after.claudeCode,
      explanation: releaseExplanation(before.claudeCode, after.claudeCode),
    });
  }
  if (before.platform !== after.platform) {
    changes.push({
      path: 'platform',
      kind: 'platform',
      impact: 'compatibility',
      before: before.platform,
      after: after.platform,
      explanation: `Platform changed from ${before.platform} to ${after.platform}; evidence from one platform should not be assumed equivalent on the other.`,
    });
  }

  const beforeGroups = groupLockSuites(before);
  const afterGroups = groupLockSuites(after);
  const components = [...new Set([...beforeGroups.keys(), ...afterGroups.keys()])].sort();

  for (const component of components) {
    const oldEntries = beforeGroups.get(component) ?? [];
    const newEntries = afterGroups.get(component) ?? [];

    if (oldEntries.length === 1 && newEntries.length === 1) {
      const oldEntry = oldEntries[0];
      const newEntry = newEntries[0];
      if (oldEntry.componentVersion !== newEntry.componentVersion) {
        changes.push({
          path: `suites.${component}.componentVersion`,
          kind: 'component-version',
          impact: 'compatibility',
          component,
          before: oldEntry.componentVersion,
          after: newEntry.componentVersion,
          explanation: `${component} changed component version from ${oldEntry.componentVersion ?? '(unversioned)'} to ${newEntry.componentVersion ?? '(unversioned)'}; compatibility should be treated as a new component target.`,
        });
      }
      compareSuiteHashes(component, oldEntry, newEntry, changes);
      continue;
    }

    const oldByIdentity = new Map(oldEntries.map((entry) => [componentLabel(component, entry.componentVersion), entry]));
    const newByIdentity = new Map(newEntries.map((entry) => [componentLabel(component, entry.componentVersion), entry]));
    const identities = [...new Set([...oldByIdentity.keys(), ...newByIdentity.keys()])].sort();
    for (const identity of identities) {
      const oldEntry = oldByIdentity.get(identity);
      const newEntry = newByIdentity.get(identity);
      if (!oldEntry && newEntry) {
        changes.push({
          path: `suites.${identity}`,
          kind: 'component-added',
          impact: 'compatibility',
          component,
          after: newEntry,
          explanation: `${identity} was added to the lock; the compatibility surface is broader than before.`,
        });
      } else if (oldEntry && !newEntry) {
        changes.push({
          path: `suites.${identity}`,
          kind: 'component-removed',
          impact: 'compatibility',
          component,
          before: oldEntry,
          explanation: `${identity} was removed from the lock; previously pinned compatibility coverage is no longer present.`,
        });
      } else if (oldEntry && newEntry) {
        compareSuiteHashes(component, oldEntry, newEntry, changes);
      }
    }
  }

  return resultFor('lock', changes, ['generatedAt']);
}

function resultChangeImpact(before: CompatibilityManifest['result'], after: CompatibilityManifest['result']): Exclude<CompatibilityDiffImpact, 'none'> {
  if (before === 'pass' && after === 'fail') return 'regression';
  return 'compatibility';
}

function resultExplanation(before: CompatibilityManifest['result'], after: CompatibilityManifest['result']): string {
  if (before === 'pass' && after === 'fail') return 'Result changed from pass to fail; this is direct regression evidence for the compared compatibility target.';
  if (before === 'fail' && after === 'pass') return 'Result changed from fail to pass; the previously failing compatibility target now has passing evidence.';
  if (after === 'unsupported') return `Result changed from ${before} to unsupported; the target is no longer claimed as tested compatibility.`;
  if (before === 'unsupported' && after === 'pass') return 'Result changed from unsupported to pass; the target now has positive compatibility evidence.';
  return `Result changed from ${before} to ${after}; review the associated evidence before updating compatibility claims.`;
}

export function diffCompatibilityManifests(before: CompatibilityManifest, after: CompatibilityManifest): CompatibilityDiffResult {
  const changes: CompatibilityDiffChange[] = [];

  if (before.canaryVersion !== after.canaryVersion) {
    changes.push({ path: 'canaryVersion', kind: 'tooling', impact: 'informational', before: before.canaryVersion, after: after.canaryVersion, explanation: `Canary tooling changed from ${before.canaryVersion} to ${after.canaryVersion}.` });
  }
  if (before.claudeCode !== after.claudeCode) {
    changes.push({ path: 'claudeCode', kind: 'release', impact: 'compatibility', before: before.claudeCode, after: after.claudeCode, explanation: releaseExplanation(before.claudeCode, after.claudeCode) });
  }
  if (before.component !== after.component) {
    changes.push({ path: 'component', kind: 'component-version', impact: 'compatibility', before: before.component, after: after.component, explanation: `Manifest component changed from ${before.component} to ${after.component}; these files describe different compatibility targets.` });
  }
  if (before.componentVersion !== after.componentVersion) {
    changes.push({ path: 'componentVersion', kind: 'component-version', impact: 'compatibility', component: after.component, before: before.componentVersion, after: after.componentVersion, explanation: `${after.component} changed component version from ${before.componentVersion ?? '(unversioned)'} to ${after.componentVersion ?? '(unversioned)'}.` });
  }
  if (before.platform !== after.platform) {
    changes.push({ path: 'platform', kind: 'platform', impact: 'compatibility', before: before.platform, after: after.platform, explanation: `Platform changed from ${before.platform} to ${after.platform}; results are not directly interchangeable across platforms.` });
  }
  if (before.suiteHash !== after.suiteHash) {
    changes.push({ path: 'suiteHash', kind: 'suite-definition', impact: 'compatibility', component: after.component, before: before.suiteHash, after: after.suiteHash, explanation: 'Suite hash changed; the scenario definition or suite selection changed, so this is not an evidence-only refresh.' });
  }
  if (before.result !== after.result) {
    changes.push({ path: 'result', kind: 'result', impact: resultChangeImpact(before.result, after.result), component: after.component, before: before.result, after: after.result, explanation: resultExplanation(before.result, after.result) });
  }
  if (before.evidenceHash !== after.evidenceHash) {
    changes.push({ path: 'evidenceHash', kind: 'evidence', impact: 'evidence', component: after.component, before: before.evidenceHash, after: after.evidenceHash, explanation: 'Evidence hash changed; the recorded run evidence differs even if the suite definition and result may be unchanged.' });
  }

  const oldFingerprints = new Set(before.failureFingerprints);
  const newFingerprints = new Set(after.failureFingerprints);
  const added = [...newFingerprints].filter((value) => !oldFingerprints.has(value)).sort();
  const removed = [...oldFingerprints].filter((value) => !newFingerprints.has(value)).sort();
  if (added.length || removed.length) {
    changes.push({
      path: 'failureFingerprints',
      kind: 'failure-fingerprints',
      impact: added.length > 0 && after.result === 'fail' ? 'regression' : 'compatibility',
      component: after.component,
      before: before.failureFingerprints,
      after: after.failureFingerprints,
      explanation: `Failure families changed: ${added.length} added, ${removed.length} removed.${added.length ? ` New: ${added.join(', ')}.` : ''}${removed.length ? ` Gone: ${removed.join(', ')}.` : ''}`,
    });
  }

  const metadataKeys = [...new Set([...Object.keys(before.metadata), ...Object.keys(after.metadata)])].sort();
  for (const key of metadataKeys) {
    if (before.metadata[key] === after.metadata[key]) continue;
    changes.push({
      path: `metadata.${key}`,
      kind: 'metadata',
      impact: 'informational',
      before: before.metadata[key],
      after: after.metadata[key],
      explanation: `Manifest metadata ${key} changed; this alters provenance/context but not the compatibility result by itself.`,
    });
  }

  return resultFor('manifest', changes, ['createdAt']);
}

function impactTag(impact: CompatibilityDiffImpact): string {
  return impact.toUpperCase();
}

export function formatCompatibilityDiff(result: CompatibilityDiffResult): string {
  const title = result.kind === 'lock' ? 'Canary lock diff' : 'Compatibility manifest diff';
  const lines = [title, `Impact: ${impactTag(result.impact)}`, result.summary];
  if (!result.changes.length) return `${lines.join('\n')}\n`;
  lines.push('');
  for (const change of result.changes) lines.push(`- [${impactTag(change.impact)}] ${change.explanation}`);
  lines.push('', `Ignored volatile field${result.ignoredFields.length === 1 ? '' : 's'}: ${result.ignoredFields.join(', ')}`);
  return `${lines.join('\n')}\n`;
}

function help(kind: CompatibilityDiffKind): string {
  const command = kind === 'lock' ? 'lock diff' : 'compat diff';
  const label = kind === 'lock' ? 'canary.lock files' : 'compatibility manifests';
  return `Explain semantic differences between two ${label}.\n\nUsage:\n  claude-canary ${command} <before> <after> [--json]\n\nOptions:\n  --json   Emit the structured diff instead of the human explanation\n  --help   Show this help\n`;
}

export async function runCompatibilityDiffCli(kind: CompatibilityDiffKind, args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(help(kind));
    return;
  }
  const files = args.filter((value) => !value.startsWith('-'));
  if (files.length !== 2) throw new Error(`${kind === 'lock' ? 'lock diff' : 'compat diff'} requires exactly two files: <before> <after>.`);
  const result = kind === 'lock'
    ? diffCanaryLocks(await loadCanaryLock(files[0]), await loadCanaryLock(files[1]))
    : diffCompatibilityManifests(await loadCompatibilityManifest(files[0]), await loadCompatibilityManifest(files[1]));
  console.log(args.includes('--json') ? JSON.stringify(result, null, 2) : formatCompatibilityDiff(result));
}
