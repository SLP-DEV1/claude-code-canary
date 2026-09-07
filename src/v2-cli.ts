#!/usr/bin/env node

const argv = process.argv.slice(2);
const suiteSubcommand = argv[0] === 'suite' ? argv[1] : undefined;
const diffCommand = (argv[0] === 'lock' || argv[0] === 'compat') && argv[1] === 'diff' ? argv[0] : undefined;

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
    await runCompatibilityDiffCli(diffCommand, argv.slice(2));
  } catch (error) {
    console.error(`claude-canary: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
} else {
  await import('./v2-core-cli.js');
  const rootHelp = argv.length === 0 ||
    (argv.length === 1 && ['--help', '-h'].includes(argv[0])) ||
    (argv[0] === 'suite' && argv.some((value) => value === '--help' || value === '-h'));
  if (rootHelp) {
    console.log(
      '\nDeveloper experience:\n' +
      '  suite init                  Create a validated scenario suite interactively\n' +
      '  suite migrate <file>        Migrate a legacy suite layout safely\n' +
      '  lock diff <old> <new>       Explain semantic canary.lock changes\n' +
      '  compat diff <old> <new>     Explain manifest regressions and evidence changes',
    );
  }
}
