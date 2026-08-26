import { spawn } from 'node:child_process';
import type { ProcessResult } from './types.js';

interface SpawnOptions {
  cwd: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

export async function spawnCapture(
  executable: string,
  args: string[],
  options: SpawnOptions,
): Promise<ProcessResult> {
  const started = Date.now();

  return await new Promise<ProcessResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const finish = (result: Omit<ProcessResult, 'durationMs'>) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ ...result, durationMs: Date.now() - started });
    };

    let child;
    try {
      child = spawn(executable, args, {
        cwd: options.cwd,
        env: options.env ?? process.env,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      finish({
        code: 127,
        signal: null,
        stdout,
        stderr: error instanceof Error ? error.message : String(error),
        timedOut: false,
      });
      return;
    }

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });

    child.on('error', (error) => {
      finish({ code: 127, signal: null, stdout, stderr: `${stderr}${error.message}`, timedOut });
    });

    child.on('close', (code, signal) => {
      finish({ code: code ?? 1, signal, stdout, stderr, timedOut });
    });

    if (options.timeoutMs && options.timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, options.timeoutMs);
      timer.unref();
    }
  });
}

export async function runShellCommand(
  command: string,
  cwd: string,
  timeoutMs = 10 * 60 * 1000,
): Promise<ProcessResult> {
  if (process.platform === 'win32') {
    return spawnCapture(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', command], { cwd, timeoutMs });
  }
  return spawnCapture('/bin/sh', ['-lc', command], { cwd, timeoutMs });
}
