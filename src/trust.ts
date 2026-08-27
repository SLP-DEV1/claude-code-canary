import { minimatch } from 'minimatch';
import { z } from 'zod';
import type { RunResult } from './types.js';

export const LifecycleTrustPolicySchema = z.object({
  require_events: z.array(z.string().min(1)).default([]),
  forbid_events: z.array(z.string().min(1)).default([]),
  deny_unexpected: z.boolean().default(false),
  max_occurrences: z.record(z.string(), z.number().int().nonnegative()).default({}),
}).strict();

export type LifecycleTrustPolicy = z.infer<typeof LifecycleTrustPolicySchema>;

export interface LifecycleTrustResult {
  passed: boolean;
  failures: string[];
  observedSequence: string[];
  counts: Record<string, number>;
}

export function evaluateLifecycleTrust(result: RunResult, policy: LifecycleTrustPolicy): LifecycleTrustResult {
  const sequence = [...(result.metrics.hookEventSequence ?? [])];
  const counts: Record<string, number> = {};
  for (const event of sequence) counts[event] = (counts[event] ?? 0) + 1;
  const failures: string[] = [];
  for (const pattern of policy.require_events) {
    if (!sequence.some((event) => minimatch(event, pattern))) failures.push(`Required lifecycle event was not observed: ${pattern}`);
  }
  for (const pattern of policy.forbid_events) {
    const matches = sequence.filter((event) => minimatch(event, pattern));
    if (matches.length) failures.push(`Forbidden lifecycle event observed (${matches.length}): ${pattern}`);
  }
  for (const [pattern, maximum] of Object.entries(policy.max_occurrences)) {
    const count = sequence.filter((event) => minimatch(event, pattern)).length;
    if (count > maximum) failures.push(`Lifecycle event ${pattern} occurred ${count} times; maximum is ${maximum}.`);
  }
  if (policy.deny_unexpected) {
    const allowed = [...policy.require_events, ...Object.keys(policy.max_occurrences)];
    for (const event of sequence) if (!allowed.some((pattern) => minimatch(event, pattern))) failures.push(`Unexpected lifecycle event: ${event}`);
  }
  return { passed: failures.length === 0, failures, observedSequence: sequence, counts };
}

export interface TrustSurfaceDiff {
  passed: boolean;
  newHookEvents: string[];
  removedHookEvents: string[];
  newToolNames: string[];
  removedToolNames: string[];
  newAutoAllowedTools: string[];
}

export function compareTrustSurfaces(baseline: RunResult, candidate: RunResult): TrustSurfaceDiff {
  const baseHooks = new Set(baseline.metrics.hookEvents ?? []);
  const candidateHooks = new Set(candidate.metrics.hookEvents ?? []);
  const baseTools = new Set(baseline.metrics.toolNames ?? []);
  const candidateTools = new Set(candidate.metrics.toolNames ?? []);
  const baseAuto = new Set(baseline.metrics.policyCoverage?.autoAllowedTools ?? []);
  const candidateAuto = new Set(candidate.metrics.policyCoverage?.autoAllowedTools ?? []);
  const newHookEvents = [...candidateHooks].filter((value) => !baseHooks.has(value)).sort();
  const removedHookEvents = [...baseHooks].filter((value) => !candidateHooks.has(value)).sort();
  const newToolNames = [...candidateTools].filter((value) => !baseTools.has(value)).sort();
  const removedToolNames = [...baseTools].filter((value) => !candidateTools.has(value)).sort();
  const newAutoAllowedTools = [...candidateAuto].filter((value) => !baseAuto.has(value)).sort();
  return {
    passed: newHookEvents.length === 0 && newAutoAllowedTools.length === 0,
    newHookEvents,
    removedHookEvents,
    newToolNames,
    removedToolNames,
    newAutoAllowedTools,
  };
}
