import { readFile, writeFile } from 'node:fs/promises';

async function patch(file, oldText, newText) {
  const current = await readFile(file, 'utf8');
  if (!current.includes(oldText)) throw new Error(`Expected integration marker missing in ${file}: ${oldText.slice(0, 100)}`);
  await writeFile(file, current.replace(oldText, newText), 'utf8');
}

await patch(
  'src/index.ts',
  "import { formatDoctor, runDoctor } from './doctor.js';",
  "import { formatDoctor, runDoctorReport } from './doctor.js';",
);

await patch(
  'src/index.ts',
  `program.command('doctor')
  .description('Check local prerequisites and repository readiness')
  .option('-e, --executable <path>', 'Claude executable', 'claude')
  .action(async (options: { executable: string }) => {
    const checks = await runDoctor(process.cwd(), options.executable);
    console.log(formatDoctor(checks));
    if (checks.some((check) => !check.ok)) process.exitCode = 1;
  });`,
  `program.command('doctor')
  .description('Check local prerequisites and extension compatibility')
  .option('-e, --executable <path>', 'Claude executable', 'claude')
  .option('--plugin <paths...>', 'plugin directories to inspect')
  .option('--json', 'print machine-readable compatibility preflight JSON', false)
  .action(async (options: { executable: string; plugin?: string[]; json: boolean }) => {
    const report = await runDoctorReport(process.cwd(), {
      claudeExecutable: options.executable,
      plugins: options.plugin,
    });
    console.log(options.json ? JSON.stringify(report, null, 2) : formatDoctor(report));
    if (!report.ok) process.exitCode = 1;
  });`,
);

await patch(
  'src/api.ts',
  "export { ScenarioSchema, loadScenario, parseScenario } from './config.js';",
  `export {
  runDoctor,
  runDoctorReport,
  formatDoctor,
  detectProviderConfiguration,
  findExecutable,
} from './doctor.js';
export type {
  DoctorOptions,
  DoctorReport,
  DoctorWarning,
  DoctorProviderMode,
  DoctorProviderReport,
  DoctorPluginReport,
  DoctorMcpReport,
  DoctorMcpServerReport,
  DoctorMcpTransport,
  DoctorBinaryRequirement,
  DoctorBinaryKind,
} from './doctor.js';

export { ScenarioSchema, loadScenario, parseScenario } from './config.js';`,
);

await patch(
  'test/api.test.ts',
  "      'runScenario',\n",
  "      'runScenario',\n      'runDoctorReport',\n      'detectProviderConfiguration',\n",
);

await patch(
  'README.md',
  '  <a href="docs/AGENT_TEAMS.md">Agent teams</a> ·\n',
  '  <a href="docs/AGENT_TEAMS.md">Agent teams</a> ·\n  <a href="docs/DOCTOR.md">Doctor</a> ·\n',
);

await patch(
  'README.md',
  '| "Did Claude change how my agent team coordinates?" | Observe real interactive teammate/task lifecycle signals and compare privacy-safe structural snapshots. |\n',
  '| "Did Claude change how my agent team coordinates?" | Observe real interactive teammate/task lifecycle signals and compare privacy-safe structural snapshots. |\n| "Is this host actually ready for my extensions?" | Run a secret-free Doctor preflight for provider mode, plugins, LSP binaries, project MCP transports and agent-team constraints. |\n',
);

await patch(
  'README.md',
  `For repository development, clone this repo and run \`npm ci --ignore-scripts && npm run build\`.

Then create and run a scenario inside the repository you want to test:`,
  `For repository development, clone this repo and run \`npm ci --ignore-scripts && npm run build\`.

Before an extension-heavy run, use the machine-readable compatibility preflight:

\`\`\`bash
claude-canary doctor --json
claude-canary doctor --plugin ./my-plugin --json
\`\`\`

It reports only non-secret configuration shape: provider mode, credential-presence booleans, plugin component types, LSP/stdio-MCP executable availability, project MCP transport types and agent-team/TTY warnings. API keys, OAuth tokens, base URLs, MCP URLs/headers and environment values are never emitted. See [Extension compatibility doctor](docs/DOCTOR.md).

Then create and run a scenario inside the repository you want to test:`,
);

await patch(
  'ROADMAP.md',
  `### P1 — Extension compatibility doctor

Expand \`doctor\` into a machine-readable environment preflight.

\`\`\`bash
claude-canary doctor --json
\`\`\`

Report only non-secret compatibility metadata:

- Claude Code version and executable source
- Canary version
- Node/platform/architecture
- configured plugin component types
- MCP transport availability
- required external binaries for LSP/plugin scenarios
- experimental feature flags relevant to a scenario
- warnings for unsupported host/provider feature combinations
`,
  `### P1 — Extension compatibility doctor *(implemented for v1.2)*

\`doctor --json\` now emits a versioned, secret-free environment preflight:

- Claude Code/Canary/Node/platform/architecture metadata and executable source;
- provider mode inferred from configuration-variable presence without exposing values;
- plugin component counts, dependencies and discovery warnings;
- LSP executable availability without launching language servers;
- bounded project \`.mcp.json\` transport discovery plus stdio executable checks without contacting remote servers;
- experimental agent-team configuration with TTY/provider compatibility warnings;
- hard failures for missing required binaries, malformed extension configuration and conflicting provider flags;
- public TypeScript API and \`schemas/doctor-result.schema.json\` contract.

Warnings remain non-fatal; hard compatibility failures make \`doctor\` exit non-zero. See \`docs/DOCTOR.md\`.
`,
);

await patch(
  'CHANGELOG.md',
  '### Added\n\n',
  '### Added\n\n- Add `doctor --json` as a schema-versioned, secret-free extension compatibility preflight for provider mode, plugins, LSP binaries, project MCP transports and experimental agent-team constraints.\n- Export the structured Doctor API/schema and fail closed on missing required LSP/stdio-MCP executables, malformed project MCP configuration and conflicting provider flags without starting extension processes.\n',
);
