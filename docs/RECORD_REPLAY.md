# Record and replay

Claude Code Canary can turn one real coding task into a reviewable regression scenario without reading or persisting Claude Code session transcripts.

## Workflow

Start from a completely clean repository, including untracked files:

```bash
claude-canary record auth-fix \
  --prompt "Fix the failing authentication test without changing the public API" \
  --setup "npm ci" \
  --verify "npm test"
```

Canary stores a small pending snapshot under the repository's Git metadata (`.git/cc-canary/recordings/`). Nothing is added to the working-tree diff.

Now run the real Claude Code task normally. You can use the interactive CLI and review the edits exactly as you usually would.

Before committing or changing branches, save the result:

```bash
claude-canary save auth-fix
```

Canary inspects the Git diff and writes a scenario such as:

```text
.canary/auth-fix.canary.yml
```

Review that YAML before treating it as a trusted regression test.

Replay it later from the exact recorded starting commit:

```bash
claude-canary replay .canary/auth-fix.canary.yml
```

You may override the executable:

```bash
claude-canary replay .canary/auth-fix.canary.yml \
  --executable /path/to/another/claude
```

This makes a recorded task useful with `compare`, configuration experiments, or future Claude Code releases after the generated assertions have been reviewed.

## What is captured

The generated scenario can contain:

- the task prompt
- the exact starting Git commit
- Claude Code `--version` output when available
- the selected model when supplied to `record`
- a portable executable name, never an absolute executable path
- the presence (names only) of common project Claude configuration files
- setup and verification commands explicitly supplied by the user
- the final changed-file set
- files that should exist after the task
- files that should be absent after the task

For every recorded changed file Canary generates both `changed_files.allow` and `changed_files.require`. That means replay fails if Claude edits an unexpected file **or** fails to touch a file that the successful recording identified as part of the task.

## What is deliberately not captured

Canary does **not** persist:

- raw environment variable values
- API keys or authentication headers
- Claude Code session transcripts
- model response text
- shell history
- contents of `settings.json`, `.mcp.json`, hooks, rules, or `CLAUDE.md` as recording metadata
- absolute repository paths

Project files obviously remain part of your Git repository; the restriction above applies to the recording metadata Canary generates.

## Redaction

Before persisting a prompt, Canary redacts common credential forms such as API tokens, bearer tokens, private-key blocks, password/secret assignments, and common machine-specific absolute paths.

If redaction changed the prompt, the generated scenario contains:

```yaml
recording:
  prompt_redacted: true
```

`replay` also prints a warning. Review the prompt because replacing a machine-specific path or secret may change the semantics of the original task.

Setup and verification commands are stricter: Canary rejects commands that appear to contain secrets or absolute machine paths instead of silently writing a command that would later be unsafe or non-portable. Prefer commands such as `npm test`, `pytest -q`, or `cargo test`, with credentials supplied through the runtime environment rather than embedded in command text.

## Why the pending state lives under `.git`

Writing the pending recording into `.canary/` before the real task would itself create an untracked file and pollute the diff that Canary is trying to learn from. Pending state therefore lives under:

```text
.git/cc-canary/recordings/<name>.json
```

The state is removed after `save` succeeds. The portable information required for replay is copied into the generated scenario.

## Exact starting-state replay

Normal `claude-canary run` keeps its existing safety rule: the tracked source checkout must be clean and the scenario starts from the current `HEAD`.

`claude-canary replay` is different. It reads `recording.git_commit`, creates a detached temporary Git worktree at that exact commit, and runs the scenario there. The current checkout may therefore contain the original successful edits while you test the replay; those edits do not leak into the detached replay worktree.

If the recorded commit is no longer available in the repository, replay fails rather than silently substituting another revision.

## Generated assertions are candidates

A recorded changed-file set is useful, but it is not proof of semantic correctness. After `save`, strengthen the scenario when possible:

- keep a deterministic test command under `verify.commands`
- remove incidental files from `changed_files.require`
- add important `file_contains` assertions
- add explicit `files_absent` assertions for files that must be removed
- add token/cost/tool-call limits only when they are stable enough to be meaningful

The design goal is to eliminate YAML boilerplate while keeping humans in control of what counts as a passing regression test.

## Current limitations

- `record` does not automatically extract the user's prompt from Claude Code transcript storage; the prompt is supplied explicitly to avoid coupling Canary to private/version-specific transcript formats.
- Save must happen before the successful edits are committed or before `HEAD` moves away from the recorded start commit.
- Content-level expectations are not inferred automatically in this first version because naive snapshots tend to create brittle tests.
- The recorder captures project configuration **presence**, not configuration contents. Configuration A/B testing remains the right tool when the configuration itself is the variable being measured.
