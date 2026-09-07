#!/usr/bin/env node

const argv = process.argv.slice(2);
const suiteInit = argv[0] === 'suite' && argv[1] === 'init';

if (suiteInit) {
  try {
    const { runSuiteInitCli } = await import('./suite-init.js');
    await runSuiteInitCli(argv.slice(2));
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
    console.log('\nDeveloper experience:\n  suite init                  Create a validated scenario suite interactively');
  }
}
