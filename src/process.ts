import { spawn } from 'node:child_process';
import type { ProcessResult } from './types.js';

const DEFAULT_MAX_OUTPUT_CHARS = 16 * 1024 * 1024;

interface SpawnOptions {
  cwd: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  maxOutputChars?: number;
}

export async function spawnCapture(
  executable: string,
  args: string[],
  options: SpawnOptions,
): Promise<ProcessResult> {
  const started = Date.now();
  const maxOutputChars = options.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;
  if (!Number.isInteger(maxOutputChars) || maxOutputChars < 1) {
    throw new Error('maxOutputChars must be a positive integer.');
  }

  return await new Promise<ProcessResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let outputTruncated = false;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const finish = (result: Omit<ProcessResult, 'durationMs'>) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ ...result, durationMs: Date.now() - started });
    };

    let child: ReturnType<typeof spawn>;
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
        outputTruncated: false,
      });
      return;
    }

    const appendBounded = (target: 'stdout' | 'stderr', chunk: string | Buffer) => {
      if (outputTruncated) return;
      const text = chunk.toString();
      const used = stdout.length + stderr.length;
      const remaining = maxOutputChars - used;
      if (remaining <= 0) {
        outputTruncated = true;
        child.kill('SIGKILL');
        return;
      }
      const accepted = text.slice(0, remaining);
      if (target === 'stdout') stdout += accepted;
      else stderr += accepted;
      if (accepted.length < text.length) {
        outputTruncated = true;
        child.kill('SIGKILL');
      }
    };

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string | Buffer) => appendBounded('stdout', chunk));
    child.stderr?.on('data', (chunk: string | Buffer) => appendBounded('stderr', chunk));

    child.on('error', (error: Error) => {
      finish({
        code: 127,
        signal: null,
        stdout,
        stderr: `${stderr}${error.message}`,
        timedOut,
        outputTruncated,
      });
    });

    child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      finish({ code: code ?? 1, signal, stdout, stderr, timedOut, outputTruncated });
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
