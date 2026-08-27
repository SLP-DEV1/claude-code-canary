import { minimatch } from 'minimatch';
import { z } from 'zod';
import type { RunMetrics } from './types.js';

export const PermissionPolicySchema = z.object({
  never_auto_allow: z.array(z.string().min(1)).default([]),
  require_prompt: z.array(z.string().min(1)).default([]),
  deny_use: z.array(z.string().min(1)).default([]),
  allow_only: z.array(z.string().min(1)).default([]),
}).strict();

export type PermissionPolicy = z.infer<typeof PermissionPolicySchema>;

export interface PermissionPolicyCoverage {
  usedTools: string[];
  promptedTools: string[];
  autoAllowedTools: string[];
  deniedCount: number;
  neverExercised: string[];
}

export interface PermissionPolicyEvaluation {
  passed: boolean;
  failures: string[];
  coverage: PermissionPolicyCoverage;
}

interface ObservedToolUse {
  id?: string;
  name: string;
  descriptors: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toolDescriptor(name: string, input: unknown): string[] {
  const descriptors = [name];
  if (!isRecord(input)) return descriptors;
  // Evaluate sensitive command/path details only in-memory. They are never returned in coverage or persisted.
  if (name === 'Bash' && typeof input.command === 'string') descriptors.push(`Bash(${input.command})`);
  if (typeof input.path === 'string') descriptors.push(`${name}(${input.path})`);
  if (typeof input.file_path === 'string') descriptors.push(`${name}(${input.file_path})`);
  return descriptors;
}

function collectToolUses(stdout: string): ObservedToolUse[] {
  const uses = new Map<string, ObservedToolUse>();
  let anonymous = 0;
  const inspect = (value: unknown): void => {
    if (Array.isArray(value)) { for (const item of value) inspect(item); return; }
    if (!isRecord(value)) return;
    if (value.type === 'tool_use' && typeof value.name === 'string') {
      const id = typeof value.id === 'string' ? value.id : undefined;
      const key = id ?? `anonymous:${anonymous++}`;
      uses.set(key, { id, name: value.name, descriptors: toolDescriptor(value.name, value.input) });
    }
    for (const child of Object.values(value)) inspect(child);
  };
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    try { inspect(JSON.parse(line)); } catch { /* stream parse errors are handled by metrics */ }
  }
  return [...uses.values()];
}

function matches(pattern: string, use: ObservedToolUse): boolean {
  return use.descriptors.some((descriptor) => minimatch(descriptor, pattern, { dot: true, nocase: false }));
}

export function evaluatePermissionPolicy(stdout: string, metrics: RunMetrics, policy: PermissionPolicy): PermissionPolicyEvaluation {
  const uses = collectToolUses(stdout);
  const promptedIds = new Set((metrics.permissionRequests ?? []).flatMap((request) => request.toolUseId ? [request.toolUseId] : []));
  const promptedNames = new Set((metrics.permissionRequests ?? []).flatMap((request) => request.toolName ? [request.toolName] : []));
  const failures: string[] = [];
  const exercisedPatterns = new Set<string>();

  for (const use of uses) {
    const prompted = use.id ? promptedIds.has(use.id) : promptedNames.has(use.name);
    for (const pattern of policy.never_auto_allow) {
      if (!matches(pattern, use)) continue;
      exercisedPatterns.add(pattern);
      if (!prompted) failures.push(`Policy violation: ${use.name} matched never_auto_allow ${JSON.stringify(pattern)} without a permission prompt.`);
    }
    for (const pattern of policy.require_prompt) {
      if (!matches(pattern, use)) continue;
      exercisedPatterns.add(pattern);
      if (!prompted) failures.push(`Policy violation: ${use.name} matched require_prompt ${JSON.stringify(pattern)} without a permission prompt.`);
    }
    for (const pattern of policy.deny_use) {
      if (!matches(pattern, use)) continue;
      exercisedPatterns.add(pattern);
      failures.push(`Policy violation: ${use.name} matched denied tool pattern ${JSON.stringify(pattern)}.`);
    }
    if (policy.allow_only.length > 0 && !policy.allow_only.some((pattern) => matches(pattern, use))) {
      failures.push(`Policy violation: ${use.name} is outside allow_only policy.`);
    }
    for (const pattern of policy.allow_only) if (matches(pattern, use)) exercisedPatterns.add(pattern);
  }

  const usedTools = [...new Set(uses.map((use) => use.name))].sort();
  const promptedTools = [...promptedNames].sort();
  const autoAllowedTools = usedTools.filter((name) => !promptedNames.has(name));
  const allPatterns = [...policy.never_auto_allow, ...policy.require_prompt, ...policy.deny_use, ...policy.allow_only];
  return {
    passed: failures.length === 0,
    failures,
    coverage: {
      usedTools,
      promptedTools,
      autoAllowedTools,
      deniedCount: metrics.permissionDenied ?? 0,
      neverExercised: [...new Set(allPatterns.filter((pattern) => !exercisedPatterns.has(pattern)))].sort(),
    },
  };
}
