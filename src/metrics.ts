import type { RunMetrics } from './types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function parseStreamMetrics(stdout: string): RunMetrics {
  const toolIds = new Set<string>();
  const hookEvents = new Set<string>();
  const hookEventSequence: string[] = [];
  let parseErrors = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;
  let costUsd: number | undefined;
  let turns: number | undefined;

  const inspectToolUses = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) inspectToolUses(item);
      return;
    }
    if (!isRecord(value)) return;
    if (value.type === 'tool_use' && typeof value.id === 'string') toolIds.add(value.id);
    for (const nested of Object.values(value)) inspectToolUses(nested);
  };

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      parseErrors += 1;
      continue;
    }

    inspectToolUses(event);
    if (!isRecord(event)) continue;

    // `--include-hook-events` emits SDK lifecycle messages such as:
    // { type: "system", subtype: "hook_started", hook_name, hook_event, ... }.
    // `hook_event_name` belongs to hook stdin, not the stream-json lifecycle message.
    if (event.type === 'system' && event.subtype === 'hook_started') {
      const lifecycleEvent = stringValue(event.hook_event);
      if (lifecycleEvent) {
        hookEvents.add(lifecycleEvent);
        hookEventSequence.push(lifecycleEvent);
      }
      const hookName = stringValue(event.hook_name);
      if (hookName) hookEvents.add(hookName);
    }

    const usage = isRecord(event.usage) ? event.usage : undefined;
    if (usage) {
      inputTokens = Math.max(inputTokens, numberValue(usage.input_tokens) ?? 0);
      outputTokens = Math.max(outputTokens, numberValue(usage.output_tokens) ?? 0);
      cacheReadTokens = Math.max(cacheReadTokens, numberValue(usage.cache_read_input_tokens) ?? 0);
      cacheCreationTokens = Math.max(cacheCreationTokens, numberValue(usage.cache_creation_input_tokens) ?? 0);
    }

    costUsd = numberValue(event.total_cost_usd) ?? costUsd;
    turns = numberValue(event.num_turns) ?? turns;
  }

  return {
    toolCalls: toolIds.size,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens,
    costUsd,
    turns,
    hookEvents: [...hookEvents].sort(),
    hookEventSequence,
    permissionPrompts: 0,
    permissionDenied: 0,
    permissionRequests: [],
    parseErrors,
  };
}
