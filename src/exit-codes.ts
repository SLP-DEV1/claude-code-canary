export const CanaryExitCode = {
  success: 0,
  regression: 2,
  infrastructure: 3,
  configuration: 4,
} as const;

export type CanaryExitCodeValue = (typeof CanaryExitCode)[keyof typeof CanaryExitCode];

export function exitCodeForSuite(result: { passed: boolean; infrastructureFailedCount: number }): CanaryExitCodeValue {
  if (result.passed) return CanaryExitCode.success;
  if (result.infrastructureFailedCount > 0) return CanaryExitCode.infrastructure;
  return CanaryExitCode.regression;
}

export function exitCodeForWatch(status: string, infrastructureFailedCount = 0): CanaryExitCodeValue {
  if (infrastructureFailedCount > 0) return CanaryExitCode.infrastructure;
  if (status === 'regression') return CanaryExitCode.regression;
  return CanaryExitCode.success;
}
