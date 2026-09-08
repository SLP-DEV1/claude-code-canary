#!/usr/bin/env node

const argv = process.argv.slice(2);
const suiteSubcommand = argv[0] === 'suite' ? argv[1] : undefined;
const diffCommand = (argv[0] === 'lock' || argv[0] === 'compat') && argv[1] === 'diff' ? argv[0] : undefined;
const diagnoseCommand = argv[0] === 'compat' && argv[1] === 'diagnose';
const registryPublishCommand = argv[0] === 'registry' && argv[1] === 'publish';

if (suiteSubcommand === 'init') {
  try {
    const { runSuiteInitCli } = await import('./suite-init.js');
    await runSuiteInitCli(argv.slice(2));
  } catch (error) {
    console.error(`claude-canary: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
} else if (suiteSubcommand === 'migrate') {
  try {
    const { runSuiteMigrateCli } = await import('./suite-migrate.js');
    await runSuiteMigrateCli(argv.slice(2));
  } catch (error) {
    console.error(`claude-canary: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
} else if (diffCommand) {
  try {
    const { runCompatibilityDiffCli } = await import('./compatibility-diff.js');
    await runCompatibilityDiffCli(diffCommand === 'lock' ? 'lock' : 'manifest', argv.slice(2));
  } catch (error) {
    console.error(`claude-canary: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
} else if (diagnoseCommand) {
  try {
    const { runCompatibilityDiagnoseCli } = await import('./compatibility-diagnostics.js');
    await runCompatibilityDiagnoseCli(argv.slice(2));
  } catch (error) {
    console.error(`claude-canary: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 4;
  }
} else if (registryPublishCommand) {
  try {
    const { runRegistryPublishCli } = await import('./registry-publish.js');
    await runRegistryPublishCli(argv.slice(2));
  } catch (error) {
    console.error(`claude-canary: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 4;
  }
} else {
  await import('./v2-core-cli.js');
  const rootHelp = argv.length === 0 ||
    (argv.length === 1 && ['--help', '-h'].includes(argv[0])) ||
    (argv[0] === 'suite' && argv.some((value) => value === '--help' || value === '-h'));
  if (rootHelp) {
    console.log(
      '\nDeveloper experience and publishing:\n' +
      '  suite init                  Create a validated scenario suite interactively\n' +
      '  suite migrate <file>        Migrate a legacy suite layout safely\n' +
      '  lock diff <old> <new>       Explain semantic canary.lock changes\n' +
      '  compat diff <old> <new>     Explain manifest regressions and evidence changes\n' +
      '  compat diagnose <file>      Diagnose invalid or stale compatibility evidence\n' +
      '  registry publish <file>     Build a static Pages/Release registry bundle',
    );
  }
}
