export interface ProcessResult {
  code: number;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  outputTruncated?: boolean;
}

export interface CommandSummary {
  command: string;
  code: number;
  durationMs: number;
  timedOut: boolean;
}

export interface PermissionRequestTrace {
  toolName?: string;
  toolUseId?: string;
  permissionMode?: string;
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
  /** Unique hook/lifecycle names retained for the v1 aggregate metric contract. */
  hookEvents: string[];
  /** Ordered lifecycle events exactly as observed from --include-hook-events. */
  hookEventSequence: string[];
  permissionPrompts: number;
  permissionDenied: number;
  permissionRequests: PermissionRequestTrace[];
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
