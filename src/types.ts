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
  /** Unique tool names observed from stream-json tool_use events. Inputs are intentionally not retained. */
  toolNames?: string[];
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  costUsd?: number;
  turns?: number;
  /** Unique hook/lifecycle names retained for the v1 aggregate metric contract. */
  hookEvents: string[];
  /** Ordered lifecycle events exactly as observed from --include-hook-events. Added additively in v1. */
  hookEventSequence?: string[];
  /** PermissionRequest count. Optional so older v1 artifacts/consumers remain source-compatible. */
  permissionPrompts?: number;
  /** PermissionDenied count. Optional so older v1 artifacts/consumers remain source-compatible. */
  permissionDenied?: number;
  /** PermissionRequest details. Optional so older v1 artifacts/consumers remain source-compatible. */
  permissionRequests?: PermissionRequestTrace[];
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
