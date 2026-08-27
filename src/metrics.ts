import type { PermissionRequestTrace, RunMetrics } from './types.js';

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
  const permissionRequests: PermissionRequestTrace[] = [];
  let permissionDenied = 0;
  let parseErrors = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;
  let costUsd: number | undefined;
  let turns: number | undefined;

  const inspect = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) inspect(item);
      return;
    }
    if (!isRecord(value)) return;

    if (value.type === 'tool_use' && typeof value.id === 'string') toolIds.add(value.id);

    // Claude Code documents hook_event_name as the lifecycle event identifier in
    // --include-hook-events stream-json output. Preserve that field in encounter
    // order instead of deriving order from the aggregate Set below.
    const lifecycleEvent = stringValue(value.hook_event_name);
    if (lifecycleEvent) {
      hookEvents.add(lifecycleEvent);
      hookEventSequence.push(lifecycleEvent);

      if (lifecycleEvent === 'PermissionRequest') {
        permissionRequests.push({
          toolName: stringValue(value.tool_name),
          toolUseId: stringValue(value.tool_use_id),
          permissionMode: stringValue(value.permission_mode),
        });
      } else if (lifecycleEvent === 'PermissionDenied') {
        permissionDenied += 1;
      }
    }

    // Retain the existing broad aggregate hook metric for backward compatibility.
    if (typeof value.type === 'string' && value.type.toLowerCase().includes('hook')) {
      hookEvents.add(value.type);
    }
    for (const key of ['hook_name', 'hookEventName']) {
      if (typeof value[key] === 'string') hookEvents.add(value[key] as string);
    }

    for (const nested of Object.values(value)) inspect(nested);
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

    inspect(event);
    if (!isRecord(event)) continue;

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
    permissionPrompts: permissionRequests.length,
    permissionDenied,
    permissionRequests,
    parseErrors,
  };
}
