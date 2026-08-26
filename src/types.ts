export interface ProcessResult {
  code: number;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export interface CommandSummary {
  command: string;
  code: number;
  durationMs: number;
  timedOut: boolean;
}

export interface RunMetrics {
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  costUsd?: number;
  turns?: number;
  hookEvents: string[];
  parseErrors: number;
}

export interface RunResult {
  schemaVersion: 1;
  scenario: string;
  executable: string;
  passed: boolean;
  failures: string[];
  claudeExitCode: number;
  claudeTimedOut: boolean;
  durationMs: number;
  changedFiles: string[];
  setup: CommandSummary[];
  verification: CommandSummary[];
  metrics: RunMetrics;
  createdAt: string;
  gitCommit: string;
  artifactPath?: string;
}

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}
