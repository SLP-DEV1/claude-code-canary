import { readFile } from 'node:fs/promises';
import YAML from 'yaml';
import { z } from 'zod';

const commandGroup = z.object({
  commands: z.array(z.string().min(1)).default([]),
}).strict();

const changedFiles = z.object({
  allow: z.array(z.string().min(1)).default([]),
  require: z.array(z.string().min(1)).default([]),
  deny: z.array(z.string().min(1)).default([]),
}).strict();

const fileContains = z.object({
  path: z.string().min(1),
  text: z.string(),
}).strict();

const permissionExpectations = z.object({
  max_prompts: z.number().int().nonnegative().optional(),
  max_denied: z.number().int().nonnegative().optional(),
  deny_prompted_tools: z.array(z.string().min(1)).default([]),
}).strict();

const hookExpectations = z.object({
  sequence: z.array(z.string().min(1)).default([]),
  deny_unexpected: z.boolean().default(false),
}).strict();

const regressionThresholds = z.object({
  max_total_tokens_increase_pct: z.number().nonnegative().optional(),
  max_input_tokens_increase_pct: z.number().nonnegative().optional(),
  max_output_tokens_increase_pct: z.number().nonnegative().optional(),
  max_reported_cost_increase_pct: z.number().nonnegative().optional(),
  max_tool_calls_increase_pct: z.number().nonnegative().optional(),
  max_permission_prompts_increase: z.number().int().nonnegative().optional(),
  max_permission_denied_increase: z.number().int().nonnegative().optional(),
  require_same_hook_sequence: z.boolean().default(false),
}).strict();

const recordingMetadata = z.object({
  git_commit: z.string().regex(/^[0-9a-f]{40}$/i),
  recorded_at: z.string().min(1),
  claude_version: z.string().min(1).optional(),
  executable: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  config_files: z.array(z.string().min(1)).default([]),
  prompt_redacted: z.boolean().default(false),
}).strict();

export const ScenarioSchema = z.object({
  version: z.literal(1),
  name: z.string().min(1),
  prompt: z.string().min(1),
  setup: commandGroup.optional(),
  claude: z.object({
    executable: z.string().min(1).default('claude'),
    args: z.array(z.string()).default([]),
    model: z.string().min(1).optional(),
    permission_mode: z.enum([
      'default',
      'acceptEdits',
      'plan',
      'auto',
      'dontAsk',
      'bypassPermissions',
    ]).optional(),
    include_hook_events: z.boolean().default(false),
    max_turns: z.number().int().positive().optional(),
    max_budget_usd: z.number().positive().optional(),
    timeout_seconds: z.number().int().positive().default(900),
    env: z.record(z.string(), z.string()).default({}),
  }).strict().default({ executable: 'claude', args: [], include_hook_events: false, timeout_seconds: 900, env: {} }),
  verify: commandGroup.optional(),
  expect: z.object({
    changed_files: changedFiles.optional(),
    files_exist: z.array(z.string().min(1)).default([]),
    files_absent: z.array(z.string().min(1)).default([]),
    file_contains: z.array(fileContains).default([]),
    claude_output_contains: z.array(z.string().min(1)).optional(),
    claude_output_absent: z.array(z.string().min(1)).optional(),
    permissions: permissionExpectations.optional(),
    hooks: hookExpectations.optional(),
  }).strict().optional(),
  limits: z.object({
    max_tool_calls: z.number().int().nonnegative().optional(),
    max_total_tokens: z.number().int().nonnegative().optional(),
    max_cost_usd: z.number().nonnegative().optional(),
  }).strict().optional(),
  regressions: regressionThresholds.optional(),
  recording: recordingMetadata.optional(),
}).strict();

export type Scenario = z.infer<typeof ScenarioSchema>;

export function parseScenario(value: unknown): Scenario {
  const parsed = ScenarioSchema.safeParse(value);
  if (parsed.success) return parsed.data;

  const details = parsed.error.issues
    .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid Canary scenario:\n${details}`);
}

export async function loadScenario(path: string): Promise<Scenario> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    throw new Error(`Could not read scenario ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    return parseScenario(YAML.parse(raw));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Invalid Canary scenario:')) throw error;
    throw new Error(`Could not parse YAML in ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
