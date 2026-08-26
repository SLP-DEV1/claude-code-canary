# Reproduction bundles

`claude-canary repro` turns a **failed** Canary result into a small, reviewable reproduction directory that can be attached to an upstream bug report.

```bash
claude-canary repro .canary/results/failed.json
```

When multiple scenarios share the same `name`, select the source explicitly:

```bash
claude-canary repro .canary/results/failed.json \
  --scenario .canary/auth-regression.canary.yml
```

Choose another destination or replace an existing bundle with:

```bash
claude-canary repro .canary/results/failed.json \
  --output ./repro-auth \
  --force
```

## Bundle layout

```text
repro-auth/
├── README.md
├── scenario.canary.yml
├── result.json
├── environment.json
├── fixture-manifest.json
├── issue-report.md
├── reproduce.sh
├── reproduce.ps1
└── fixture/
```

`reproduce.sh` and `reproduce.ps1` initialize `fixture/` as a local Git repository, create a baseline commit and execute the bundled scenario with `claude-canary run ../scenario.canary.yml`.

## What is exported

Canary starts from the scenario's recorded Git commit when `recording.git_commit` exists. Otherwise it uses the `gitCommit` stored in the result artifact. The commit must resolve locally or export fails.

Fixture selection is deliberately narrow. Canary derives roots from:

- `expect.changed_files.allow`
- `expect.changed_files.require`
- `expect.files_exist`
- `expect.files_absent`
- `expect.file_contains[].path`
- a small set of ecosystem manifests when setup/verification commands clearly require them, such as `package.json`, lockfiles, `pyproject.toml`, `Cargo.toml`, `go.mod` or `pom.xml`

A glob such as `src/auth/*.ts` exports `src/auth/`, not the whole repository. A top-level wildcard such as `*.ts` does not cause Canary to export the repository root.

Only text files are copied. Binary files are skipped. Individual files, total fixture size and total file count are bounded so an accidentally broad assertion cannot silently create a huge bundle.

## Hard exclusions

Canary refuses or skips known high-risk/non-portable paths, including:

- `.git`
- `.env` and `.env.*`
- `.npmrc`, `.pypirc`, `.netrc`
- private-key style filenames and key/certificate containers
- credential/secret files by common filename patterns
- `node_modules`
- common build, cache, virtual-environment and coverage directories
- symlinks

Symlinks are never followed during fixture export. This prevents an in-repository symlink from pulling data from outside the repository.

## Redaction

Exported text is scanned with Canary's record/replay redactor. It removes common credential/token shapes, private-key blocks and machine-specific absolute paths.

The generated scenario is sanitized separately:

- `claude.env` is always emptied
- absolute Claude executable paths are reduced to their basename
- the prompt is redacted
- setup/verification commands or Claude arguments that contain secret-like values or machine-specific absolute paths cause export to fail instead of being silently rewritten
- denylisted `recording.config_files` entries are removed

The exported `result.json` is redacted and omits `artifactPath`.

## Minimal environment manifest

`environment.json` intentionally contains only reproduction metadata:

- bundle schema version
- Canary version
- OS platform and architecture
- Node version
- scenario name
- base Git commit
- result timestamp
- Claude executable basename
- recorded Claude version/model when available

It does **not** include environment-variable values, usernames, hostnames, home directories or raw Claude transcripts.

## Issue report

`issue-report.md` contains a compact upstream-ready summary:

- pass/fail state
- base Git commit
- Claude version/model metadata when available
- deterministic Canary failures
- changed files
- tool-call/token counts
- shell and PowerShell reproduction commands

Raw model output is not included.

## Threat model and review requirement

Repro bundles are privacy-first, not a data-loss-prevention product. Generic secret detection cannot know which source files, comments, test fixtures, customer names or business logic are confidential to your project.

**Always inspect the entire generated directory before publishing or attaching it to an issue.**

Canary deliberately favors false negatives in reproducibility over false positives in data export: suspicious paths, binaries, symlinks and oversized scopes are skipped or rejected rather than copied automatically.

## Known limitation: minimal fixtures

The exported fixture is built from deterministic scenario scope, not from the whole repository. That keeps bundles small and safer to share, but a task can depend on project context that is not expressible through current assertions. If the generated fixture is too small to reproduce the problem, explicitly narrow and add the required safe paths to the scenario before regenerating the bundle rather than exporting the entire repository.
