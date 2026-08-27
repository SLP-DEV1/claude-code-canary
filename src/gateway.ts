import { readFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { z } from 'zod';
import { runSuite, type SuiteRunResult } from './suite.js';

const GatewayVariantSchema = z.object({
  name: z.string().min(1),
  env: z.record(z.string().min(1), z.string()).default({}),
  tags: z.array(z.string().min(1)).default([]),
}).strict();

export const GatewayMatrixSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().min(1),
  suite: z.string().min(1),
  variants: z.array(GatewayVariantSchema).min(1),
}).strict();

export type GatewayMatrix = z.infer<typeof GatewayMatrixSchema>;

export interface GatewayMatrixResult {
  schemaVersion: 1;
  name: string;
  createdAt: string;
  passed: boolean;
  variants: Array<{
    name: string;
    envKeys: string[];
    passed: boolean;
    suite: SuiteRunResult;
  }>;
}

function resolveEnvValue(value: string): string {
  const match = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(value);
  if (!match) return value;
  const resolved = process.env[match[1]];
  if (resolved === undefined) throw new Error(`Gateway matrix requires environment variable ${match[1]}, but it is not set.`);
  return resolved;
}

export async function loadGatewayMatrix(file: string): Promise<GatewayMatrix> {
  return GatewayMatrixSchema.parse(YAML.parse(await readFile(file, 'utf8')));
}

export async function runGatewayMatrix(file: string, options: { cwd?: string; executableOverride?: string; concurrency?: number } = {}): Promise<GatewayMatrixResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const matrix = await loadGatewayMatrix(path.resolve(cwd, file));
  const variants: GatewayMatrixResult['variants'] = [];

  for (const variant of matrix.variants) {
    const previous = new Map<string, string | undefined>();
    try {
      for (const [key, configured] of Object.entries(variant.env)) {
        previous.set(key, process.env[key]);
        process.env[key] = resolveEnvValue(configured);
      }
      const suite = await runSuite(matrix.suite, {
        cwd,
        executableOverride: options.executableOverride,
        concurrency: options.concurrency,
        artifactLabel: `gateway-${variant.name}`,
      });
      variants.push({
        name: variant.name,
        envKeys: Object.keys(variant.env).sort(),
        passed: suite.passed,
        suite,
      });
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }

  return {
    schemaVersion: 1,
    name: matrix.name,
    createdAt: new Date().toISOString(),
    passed: variants.every((variant) => variant.passed),
    variants,
  };
}
