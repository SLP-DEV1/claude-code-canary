import { readFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import type { ZodIssue, ZodType } from 'zod';
import {
  CanaryLockSchema,
  CompatibilityManifestSchema,
  CompatibilityRegistrySchema,
  checkCanaryLock,
  sha256Canonical,
  type CanaryLock,
  type CompatibilityManifest,
  type CompatibilityRegistry,
} from './compatibility.js';
import { CanaryExitCode } from './exit-codes.js';

export type CompatibilityArtifactKind = 'manifest' | 'registry' | 'lock' | 'unknown';
export type EvidenceDiagnosticSeverity = 'error' | 'warning' | 'info';

export interface EvidenceDiagnostic {
  code: string;
  severity: EvidenceDiagnosticSeverity;
  path?: string;
  message: string;
  fix?: string;
}

export interface CompatibilityDiagnosticOptions {
  now?: Date;
  maxAgeDays?: number;
  expectedClaudeCode?: string;
  expectedPlatform?: string;
  expectedComponent?: string;
  expectedComponentVersion?: string;
  evidence?: unknown;
  suiteDefinition?: unknown;
  manifests?: CompatibilityManifest[];
}

export interface CompatibilityDiagnosticResult {
  schemaVersion: 1;
  file?: string;
  kind: CompatibilityArtifactKind;
  valid: boolean;
  stale: boolean;
  passed: boolean;
  summary: string;
  diagnostics: EvidenceDiagnostic[];
}

interface SupportReadResult<T> {
  value?: T;
  diagnostics: EvidenceDiagnostic[];
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export function detectCompatibilityArtifactKind(value: unknown): CompatibilityArtifactKind {
  const data = record(value);
  if (!data) return 'unknown';
  if ('suites' in data || ('generatedAt' in data && 'claudeCode' in data && 'platform' in data)) return 'lock';
  if ('manifests' in data || ('name' in data && 'generatedAt' in data)) return 'registry';
  if ('evidenceHash' in data || 'suiteHash' in data || 'component' in data) return 'manifest';
  return 'unknown';
}

function pathLabel(issue: ZodIssue): string {
  return issue.path.length ? issue.path.map(String).join('.') : '<root>';
}

function schemaDiagnostics(kind: Exclude<CompatibilityArtifactKind, 'unknown'>, issues: ZodIssue[]): EvidenceDiagnostic[] {
  const command = kind === 'manifest' ? 'compat manifest' : kind === 'registry' ? 'compat merge' : 'lock create';
  return issues.map((issue) => ({
    code: 'schema-invalid',
    severity: 'error',
    path: pathLabel(issue),
    message: issue.message,
    fix: `Regenerate this ${kind} with the current claude-canary ${command} command instead of editing schema fields or hashes manually.`,
  }));
}

function parseKind<T>(kind: Exclude<CompatibilityArtifactKind, 'unknown'>, schema: ZodType<T>, value: unknown): { value?: T; diagnostics: EvidenceDiagnostic[] } {
  const parsed = schema.safeParse(value);
  if (parsed.success) return { value: parsed.data, diagnostics: [] };
  return { diagnostics: schemaDiagnostics(kind, parsed.error.issues) };
}

function timestampDiagnostic(
  value: string,
  field: string,
  now: Date,
  maxAgeDays: number | undefined,
  staleState: { value: boolean },
): EvidenceDiagnostic[] {
  const diagnostics: EvidenceDiagnostic[] = [];
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    diagnostics.push({
      code: 'timestamp-invalid',
      severity: 'error',
      path: field,
      message: `${field} is not a valid date/time: ${JSON.stringify(value)}.`,
      fix: 'Regenerate the artifact so Canary writes a valid ISO-8601 timestamp.',
    });
    return diagnostics;
  }
  const ageMs = now.getTime() - milliseconds;
  if (ageMs < -5 * 60 * 1000) {
    staleState.value = true;
    diagnostics.push({
      code: 'timestamp-future',
      severity: 'warning',
      path: field,
      message: `${field} is in the future relative to the diagnostic clock.`,
      fix: 'Check host clock synchronization, then regenerate the evidence if the timestamp is incorrect.',
    });
  }
  if (maxAgeDays !== undefined && ageMs > maxAgeDays * 86_400_000) {
    staleState.value = true;
    diagnostics.push({
      code: 'age-exceeded',
      severity: 'warning',
      path: field,
      message: `Evidence is older than the configured ${maxAgeDays}-day freshness window.`,
      fix: 'Run the relevant suite/watch again and publish fresh compatibility evidence.',
    });
  }
  return diagnostics;
}

function mismatch(
  diagnostics: EvidenceDiagnostic[],
  staleState: { value: boolean },
  code: string,
  field: string,
  actual: string | undefined,
  expected: string | undefined,
  subject: string,
): void {
  if (expected === undefined || actual === expected) return;
  staleState.value = true;
  diagnostics.push({
    code,
    severity: 'warning',
    path: field,
    message: `${subject} mismatch: evidence=${actual ?? '(missing)'}, expected=${expected}.`,
    fix: `Regenerate evidence for ${expected} or update the expected target only after reviewing the compatibility change.`,
  });
}

function identity(manifest: CompatibilityManifest): string {
  return [manifest.component, manifest.componentVersion ?? '', manifest.claudeCode, manifest.platform].join('\u0000');
}

function lockIdentity(entry: CanaryLock['suites'][number]): string {
  return `${entry.component}\u0000${entry.componentVersion ?? ''}`;
}

function diagnoseManifest(manifest: CompatibilityManifest, options: CompatibilityDiagnosticOptions, diagnostics: EvidenceDiagnostic[], staleState: { value: boolean }): void {
  const now = options.now ?? new Date();
  diagnostics.push(...timestampDiagnostic(manifest.createdAt, 'createdAt', now, options.maxAgeDays, staleState));
  mismatch(diagnostics, staleState, 'release-mismatch', 'claudeCode', manifest.claudeCode, options.expectedClaudeCode, 'Claude Code release');
  mismatch(diagnostics, staleState, 'platform-mismatch', 'platform', manifest.platform, options.expectedPlatform, 'Platform');
  mismatch(diagnostics, staleState, 'component-mismatch', 'component', manifest.component, options.expectedComponent, 'Component');
  mismatch(diagnostics, staleState, 'component-version-mismatch', 'componentVersion', manifest.componentVersion, options.expectedComponentVersion, 'Component version');

  if (options.evidence !== undefined) {
    const current = sha256Canonical(options.evidence);
    if (current !== manifest.evidenceHash) {
      staleState.value = true;
      diagnostics.push({
        code: 'evidence-hash-mismatch',
        severity: 'warning',
        path: 'evidenceHash',
        message: `Manifest evidenceHash does not match the supplied evidence (${manifest.evidenceHash} != ${current}).`,
        fix: 'Regenerate the compatibility manifest from the current evidence file before publishing or locking it.',
      });
    }
  }
  if (options.suiteDefinition !== undefined) {
    const current = sha256Canonical(options.suiteDefinition);
    if (current !== manifest.suiteHash) {
      staleState.value = true;
      diagnostics.push({
        code: 'suite-hash-mismatch',
        severity: 'warning',
        path: 'suiteHash',
        message: `Manifest suiteHash does not match the supplied suite definition (${manifest.suiteHash} != ${current}).`,
        fix: 'Re-run the suite and regenerate compatibility evidence; the manifest was produced for a different suite definition.',
      });
    }
  }
}

function diagnoseRegistry(registry: CompatibilityRegistry, options: CompatibilityDiagnosticOptions, diagnostics: EvidenceDiagnostic[], staleState: { value: boolean }): void {
  const now = options.now ?? new Date();
  diagnostics.push(...timestampDiagnostic(registry.generatedAt, 'generatedAt', now, options.maxAgeDays, staleState));
  const generatedMs = Date.parse(registry.generatedAt);
  const byIdentity = new Map<string, CompatibilityManifest>();

  registry.manifests.forEach((manifest, index) => {
    const field = `manifests.${index}.createdAt`;
    diagnostics.push(...timestampDiagnostic(manifest.createdAt, field, now, options.maxAgeDays, staleState));
    const createdMs = Date.parse(manifest.createdAt);
    if (Number.isFinite(generatedMs) && Number.isFinite(createdMs) && createdMs > generatedMs + 1000) {
      staleState.value = true;
      diagnostics.push({
        code: 'registry-older-than-evidence',
        severity: 'warning',
        path: field,
        message: `Registry generatedAt predates embedded evidence for ${manifest.component}.`,
        fix: 'Rebuild the registry with `claude-canary compat merge` so generatedAt reflects its current manifest set.',
      });
    }
    const key = identity(manifest);
    const previous = byIdentity.get(key);
    if (previous && (previous.evidenceHash !== manifest.evidenceHash || previous.suiteHash !== manifest.suiteHash || previous.result !== manifest.result)) {
      staleState.value = true;
      diagnostics.push({
        code: 'registry-conflicting-evidence',
        severity: 'warning',
        path: `manifests.${index}`,
        message: `Registry contains conflicting evidence for ${manifest.component}${manifest.componentVersion ? `@${manifest.componentVersion}` : ''} on Claude Code ${manifest.claudeCode}/${manifest.platform}.`,
        fix: 'Remove superseded evidence or rebuild the registry from the intended manifest set before querying compatibility.',
      });
    } else if (!previous) {
      byIdentity.set(key, manifest);
    }
  });
}

function diagnoseLock(lock: CanaryLock, options: CompatibilityDiagnosticOptions, diagnostics: EvidenceDiagnostic[], staleState: { value: boolean }): void {
  const now = options.now ?? new Date();
  diagnostics.push(...timestampDiagnostic(lock.generatedAt, 'generatedAt', now, options.maxAgeDays, staleState));
  mismatch(diagnostics, staleState, 'release-mismatch', 'claudeCode', lock.claudeCode, options.expectedClaudeCode, 'Claude Code release');
  mismatch(diagnostics, staleState, 'platform-mismatch', 'platform', lock.platform, options.expectedPlatform, 'Platform');

  const seen = new Map<string, CanaryLock['suites'][number]>();
  lock.suites.forEach((entry, index) => {
    const key = lockIdentity(entry);
    const previous = seen.get(key);
    if (previous && (previous.suiteHash !== entry.suiteHash || previous.evidenceHash !== entry.evidenceHash)) {
      staleState.value = true;
      diagnostics.push({
        code: 'lock-conflicting-entry',
        severity: 'warning',
        path: `suites.${index}`,
        message: `canary.lock contains conflicting entries for ${entry.component}${entry.componentVersion ? `@${entry.componentVersion}` : ''}.`,
        fix: 'Recreate the lock from one reviewed manifest per component identity.',
      });
    } else if (!previous) {
      seen.set(key, entry);
    }
  });

  if (options.manifests) {
    const check = checkCanaryLock(lock, {
      claudeCode: options.expectedClaudeCode ?? lock.claudeCode,
      platform: options.expectedPlatform ?? lock.platform,
      manifests: options.manifests,
    });
    for (const failure of check.failures) {
      staleState.value = true;
      const code = failure.startsWith('Missing compatibility evidence') ? 'lock-missing-evidence'
        : failure.startsWith('Suite drift') ? 'lock-suite-drift'
          : failure.startsWith('Evidence drift') ? 'lock-evidence-drift'
            : failure.startsWith('Manifest Claude Code drift') ? 'lock-manifest-release-drift'
              : failure.startsWith('Manifest platform drift') ? 'lock-manifest-platform-drift'
                : failure.startsWith('Claude Code drift') ? 'release-mismatch'
                  : failure.startsWith('Platform drift') ? 'platform-mismatch'
                    : 'lock-drift';
      diagnostics.push({
        code,
        severity: 'warning',
        message: failure,
        fix: 'Regenerate the affected manifest, review `claude-canary lock diff`, and recreate canary.lock only after accepting the drift.',
      });
    }
  }
}

function finalize(kind: CompatibilityArtifactKind, diagnostics: EvidenceDiagnostic[], stale: boolean, file?: string): CompatibilityDiagnosticResult {
  const valid = !diagnostics.some((item) => item.severity === 'error');
  const passed = valid && !stale;
  const status = !valid ? 'invalid' : stale ? 'stale' : 'valid and current';
  const issueCount = diagnostics.length;
  return {
    schemaVersion: 1,
    file,
    kind,
    valid,
    stale,
    passed,
    summary: `${kind === 'unknown' ? 'Compatibility artifact' : `Compatibility ${kind}`} is ${status}${issueCount ? ` (${issueCount} diagnostic${issueCount === 1 ? '' : 's'})` : ''}.`,
    diagnostics,
  };
}

export function diagnoseCompatibilityArtifact(value: unknown, options: CompatibilityDiagnosticOptions = {}): CompatibilityDiagnosticResult {
  const kind = detectCompatibilityArtifactKind(value);
  const diagnostics: EvidenceDiagnostic[] = [];
  const staleState = { value: false };

  if (options.maxAgeDays !== undefined && (!Number.isFinite(options.maxAgeDays) || options.maxAgeDays <= 0)) {
    diagnostics.push({ code: 'max-age-invalid', severity: 'error', path: 'maxAgeDays', message: 'maxAgeDays must be a positive number.' });
    return finalize(kind, diagnostics, false);
  }

  if (kind === 'unknown') {
    diagnostics.push({
      code: 'kind-unknown',
      severity: 'error',
      message: 'Could not identify this JSON object as a compatibility manifest, registry, or canary.lock.',
      fix: 'Use an artifact generated by `compat manifest`, `compat merge`, or `lock create`.',
    });
    return finalize(kind, diagnostics, false);
  }

  if (kind === 'manifest') {
    const parsed = parseKind('manifest', CompatibilityManifestSchema, value);
    diagnostics.push(...parsed.diagnostics);
    if (parsed.value) diagnoseManifest(parsed.value, options, diagnostics, staleState);
  } else if (kind === 'registry') {
    const parsed = parseKind('registry', CompatibilityRegistrySchema, value);
    diagnostics.push(...parsed.diagnostics);
    if (parsed.value) diagnoseRegistry(parsed.value, options, diagnostics, staleState);
  } else {
    const parsed = parseKind('lock', CanaryLockSchema, value);
    diagnostics.push(...parsed.diagnostics);
    if (parsed.value) diagnoseLock(parsed.value, options, diagnostics, staleState);
  }

  return finalize(kind, diagnostics, staleState.value);
}

export async function diagnoseCompatibilityFile(file: string, options: CompatibilityDiagnosticOptions = {}): Promise<CompatibilityDiagnosticResult> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (error) {
    return finalize('unknown', [{
      code: 'read-error',
      severity: 'error',
      message: `Could not read ${file}: ${error instanceof Error ? error.message : String(error)}`,
      fix: 'Check the path and file permissions.',
    }], false, file);
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    return finalize('unknown', [{
      code: 'json-invalid',
      severity: 'error',
      message: `Invalid JSON in ${file}: ${error instanceof Error ? error.message : String(error)}`,
      fix: 'Regenerate the artifact instead of repairing compatibility hashes by hand.',
    }], false, file);
  }
  const result = diagnoseCompatibilityArtifact(value, options);
  return { ...result, file };
}

export function formatCompatibilityDiagnostics(result: CompatibilityDiagnosticResult): string {
  const status = !result.valid ? 'INVALID' : result.stale ? 'STALE' : 'OK';
  const lines = [
    'Compatibility evidence diagnostics',
    `Status: ${status}`,
    `Artifact: ${result.kind}`,
    result.summary,
  ];
  if (!result.diagnostics.length) return `${lines.join('\n')}\n`;
  lines.push('');
  for (const diagnostic of result.diagnostics) {
    const location = diagnostic.path ? ` ${diagnostic.path}` : '';
    lines.push(`- [${diagnostic.severity.toUpperCase()}]${location}: ${diagnostic.message}`);
    if (diagnostic.fix) lines.push(`  Fix: ${diagnostic.fix}`);
  }
  return `${lines.join('\n')}\n`;
}

function valueAfter(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function supportPath(file: string, field?: string): string {
  return field ? `${file}:${field}` : file;
}

async function readStructuredSupportFile(file: string, role: string): Promise<SupportReadResult<unknown>> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (error) {
    return {
      diagnostics: [{
        code: 'support-read-error',
        severity: 'error',
        path: file,
        message: `Could not read ${role} file ${file}: ${error instanceof Error ? error.message : String(error)}`,
        fix: `Check the ${role} path and file permissions.`,
      }],
    };
  }

  try {
    return {
      value: /\.ya?ml$/i.test(path.extname(file)) ? YAML.parse(raw) : JSON.parse(raw),
      diagnostics: [],
    };
  } catch (error) {
    return {
      diagnostics: [{
        code: 'support-parse-error',
        severity: 'error',
        path: file,
        message: `Could not parse ${role} file ${file}: ${error instanceof Error ? error.message : String(error)}`,
        fix: `Regenerate or repair the ${role} file before using it for compatibility diagnostics.`,
      }],
    };
  }
}

async function loadManifestSupportFile(file: string): Promise<SupportReadResult<CompatibilityManifest>> {
  const loaded = await readStructuredSupportFile(file, 'manifest');
  if (loaded.value === undefined) return { diagnostics: loaded.diagnostics };
  const parsed = CompatibilityManifestSchema.safeParse(loaded.value);
  if (parsed.success) return { value: parsed.data, diagnostics: [] };
  return {
    diagnostics: parsed.error.issues.map((issue) => ({
      code: 'support-schema-invalid',
      severity: 'error',
      path: supportPath(file, pathLabel(issue)),
      message: `Invalid manifest ${file}: ${issue.message}`,
      fix: 'Regenerate this manifest with `claude-canary compat manifest` before using it with --manifests.',
    })),
  };
}

function help(): string {
  return `Diagnose invalid or stale compatibility evidence without running Claude.\n\nUsage:\n  claude-canary compat diagnose <artifact.json> [options]\n\nOptions:\n  --evidence <file>           Verify a manifest evidenceHash against current evidence\n  --suite-definition <file>   Verify a manifest suiteHash against JSON/YAML definition data\n  --manifests <a,b,...>       Check canary.lock against current manifest files\n  --claude <version>          Expected Claude Code release\n  --platform <id>             Expected platform\n  --component <name>          Expected component for a manifest\n  --component-version <ver>   Expected component version for a manifest\n  --max-age-days <days>       Mark evidence older than this freshness window stale\n  --json                      Emit structured diagnostics\n  --help                      Show this help\n`;
}

function emitCliConfigurationError(message: string, json: boolean, file?: string): void {
  const result = finalize('unknown', [{
    code: 'cli-invalid',
    severity: 'error',
    message,
    fix: 'Run `claude-canary compat diagnose --help` and correct the command arguments.',
  }], false, file);
  console.log(json ? JSON.stringify(result, null, 2) : formatCompatibilityDiagnostics(result));
  process.exitCode = CanaryExitCode.configuration;
}

export async function runCompatibilityDiagnoseCli(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(help());
    return;
  }

  const json = args.includes('--json');
  const file = args[0];
  if (!file || file.startsWith('-')) {
    emitCliConfigurationError('compat diagnose requires <artifact.json>.', json);
    return;
  }

  const flags = new Set(['--json','--help','-h']);
  const valueOptions = new Set(['--evidence','--suite-definition','--manifests','--claude','--platform','--component','--component-version','--max-age-days']);
  const known = new Set([...flags, ...valueOptions]);
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith('-')) continue;
    if (!known.has(arg)) {
      emitCliConfigurationError(`Unknown compat diagnose option: ${arg}`, json, file);
      return;
    }
    if (valueOptions.has(arg)) {
      const value = args[index + 1];
      if (!value || value.startsWith('-')) {
        emitCliConfigurationError(`Option ${arg} requires a value.`, json, file);
        return;
      }
      index += 1;
    }
  }

  const maxAgeRaw = valueAfter(args, '--max-age-days');
  const maxAgeDays = maxAgeRaw === undefined ? undefined : Number(maxAgeRaw);
  const evidenceFile = valueAfter(args, '--evidence');
  const suiteFile = valueAfter(args, '--suite-definition');
  const manifestFiles = valueAfter(args, '--manifests')?.split(',').map((item) => item.trim()).filter(Boolean) ?? [];

  const supportDiagnostics: EvidenceDiagnostic[] = [];
  let evidence: unknown;
  let suiteDefinition: unknown;
  const manifests: CompatibilityManifest[] = [];

  if (evidenceFile) {
    const loaded = await readStructuredSupportFile(evidenceFile, 'evidence');
    supportDiagnostics.push(...loaded.diagnostics);
    evidence = loaded.value;
  }
  if (suiteFile) {
    const loaded = await readStructuredSupportFile(suiteFile, 'suite definition');
    supportDiagnostics.push(...loaded.diagnostics);
    suiteDefinition = loaded.value;
  }
  for (const manifestFile of manifestFiles) {
    const loaded = await loadManifestSupportFile(manifestFile);
    supportDiagnostics.push(...loaded.diagnostics);
    if (loaded.value) manifests.push(loaded.value);
  }

  const options: CompatibilityDiagnosticOptions = {
    maxAgeDays,
    expectedClaudeCode: valueAfter(args, '--claude'),
    expectedPlatform: valueAfter(args, '--platform'),
    expectedComponent: valueAfter(args, '--component'),
    expectedComponentVersion: valueAfter(args, '--component-version'),
    evidence,
    suiteDefinition,
    manifests: manifestFiles.length ? manifests : undefined,
  };
  const baseResult = await diagnoseCompatibilityFile(file, options);
  const result = supportDiagnostics.length
    ? finalize(baseResult.kind, [...baseResult.diagnostics, ...supportDiagnostics], baseResult.stale, baseResult.file)
    : baseResult;

  console.log(json ? JSON.stringify(result, null, 2) : formatCompatibilityDiagnostics(result));
  if (!result.valid) process.exitCode = CanaryExitCode.configuration;
  else if (result.stale) process.exitCode = CanaryExitCode.regression;
}
