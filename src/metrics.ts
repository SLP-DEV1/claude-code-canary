import type { RunMetrics } from './types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function parseStreamMetrics(stdout: string): RunMetrics {
  const toolIds = new Set<string>();
  const hookEvents = new Set<string>();
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

    if (typeof value.type === 'string' && value.type.toLowerCase().includes('hook')) {
      hookEvents.add(value.type);
    }
    for (const key of ['hook_event_name', 'hook_name', 'hookEventName']) {
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
    parseErrors,
  };
}
