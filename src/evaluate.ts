import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { minimatch } from 'minimatch';
import type { Scenario } from './config.js';
import type { RunMetrics } from './types.js';

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isOrderedSubsequence(expected: string[], actual: string[]): boolean {
  if (expected.length === 0) return true;
  let expectedIndex = 0;
  for (const event of actual) {
    if (event === expected[expectedIndex]) expectedIndex += 1;
    if (expectedIndex === expected.length) return true;
  }
  return false;
}

function formatSequence(sequence: string[]): string {
  return sequence.length === 0 ? '(none)' : sequence.join(' -> ');
}

export async function evaluateExpectations(
  scenario: Scenario,
  worktree: string,
  changedFiles: string[],
  metrics: RunMetrics,
  claudeOutput = '',
): Promise<string[]> {
  const failures: string[] = [];
  const expected = scenario.expect;
  const permissionPrompts = metrics.permissionPrompts ?? 0;
  const permissionDenied = metrics.permissionDenied ?? 0;
  const permissionRequests = metrics.permissionRequests ?? [];
  const hookEventSequence = metrics.hookEventSequence ?? [];

  const allowed = expected?.changed_files?.allow ?? [];
  if (allowed.length > 0) {
    for (const file of changedFiles) {
      if (!allowed.some((pattern) => minimatch(file, pattern, { dot: true }))) {
        failures.push(`Unexpected changed file: ${file}`);
      }
    }
  }

  for (const pattern of expected?.changed_files?.require ?? []) {
    if (!changedFiles.some((file) => minimatch(file, pattern, { dot: true }))) {
      failures.push(`Required changed file missing: ${pattern}`);
    }
  }

  for (const pattern of expected?.changed_files?.deny ?? []) {
    for (const file of changedFiles) {
      if (minimatch(file, pattern, { dot: true })) failures.push(`Forbidden file changed: ${file} (matched ${pattern})`);
    }
  }

  for (const file of expected?.files_exist ?? []) {
    if (!(await exists(path.join(worktree, file)))) failures.push(`Expected file does not exist: ${file}`);
  }

  for (const file of expected?.files_absent ?? []) {
    if (await exists(path.join(worktree, file))) failures.push(`Expected file to be absent: ${file}`);
  }

  for (const assertion of expected?.file_contains ?? []) {
    try {
      const content = await readFile(path.join(worktree, assertion.path), 'utf8');
      if (!content.includes(assertion.text)) failures.push(`File ${assertion.path} does not contain expected text`);
    } catch {
      failures.push(`Could not read file for content assertion: ${assertion.path}`);
    }
  }

  for (const text of expected?.claude_output_contains ?? []) {
    if (!claudeOutput.includes(text)) failures.push(`Claude output does not contain expected text: ${JSON.stringify(text)}`);
  }

  for (const text of expected?.claude_output_absent ?? []) {
    if (claudeOutput.includes(text)) failures.push(`Claude output contains forbidden text: ${JSON.stringify(text)}`);
  }

  if (expected?.permissions?.max_prompts !== undefined && permissionPrompts > expected.permissions.max_prompts) {
    failures.push(`Permission-prompt limit exceeded: ${permissionPrompts} > ${expected.permissions.max_prompts}`);
  }
  if (expected?.permissions?.max_denied !== undefined && permissionDenied > expected.permissions.max_denied) {
    failures.push(`Permission-denied limit exceeded: ${permissionDenied} > ${expected.permissions.max_denied}`);
  }
  for (const request of permissionRequests) {
    if (!request.toolName) continue;
    for (const pattern of expected?.permissions?.deny_prompted_tools ?? []) {
      if (minimatch(request.toolName, pattern)) {
        failures.push(`Unexpected permission prompt for tool ${request.toolName} (matched ${pattern})`);
        break;
      }
    }
  }

  const expectedHookSequence = expected?.hooks?.sequence ?? [];
  if (expected?.hooks?.deny_unexpected) {
    const exactMatch = expectedHookSequence.length === hookEventSequence.length
      && expectedHookSequence.every((event, index) => event === hookEventSequence[index]);
    if (!exactMatch) {
      failures.push(`Hook sequence mismatch: expected exactly ${formatSequence(expectedHookSequence)}; observed ${formatSequence(hookEventSequence)}`);
    }
  } else if (!isOrderedSubsequence(expectedHookSequence, hookEventSequence)) {
    failures.push(`Hook sequence missing or out of order: expected ${formatSequence(expectedHookSequence)} within ${formatSequence(hookEventSequence)}`);
  }

  if (scenario.limits?.max_tool_calls !== undefined && metrics.toolCalls > scenario.limits.max_tool_calls) {
    failures.push(`Tool-call limit exceeded: ${metrics.toolCalls} > ${scenario.limits.max_tool_calls}`);
  }
  if (scenario.limits?.max_total_tokens !== undefined && metrics.totalTokens > scenario.limits.max_total_tokens) {
    failures.push(`Token limit exceeded: ${metrics.totalTokens} > ${scenario.limits.max_total_tokens}`);
  }
  if (scenario.limits?.max_cost_usd !== undefined) {
    if (metrics.costUsd === undefined) {
      failures.push('Cost limit is configured but Claude did not report total_cost_usd; refusing to pass an unmeasured cost constraint.');
    } else if (metrics.costUsd > scenario.limits.max_cost_usd) {
      failures.push(`Cost limit exceeded: $${metrics.costUsd.toFixed(4)} > $${scenario.limits.max_cost_usd.toFixed(4)}`);
    }
  }

  return failures;
}
