export const DEFAULT_SCENARIO = `# Claude Code Canary scenario
version: 1
name: canary-smoke-test

prompt: |
  Create a new file named canary-proof.txt containing exactly the line CANARY_OK.
  Do not modify any other file.

claude:
  executable: claude
  permission_mode: acceptEdits
  max_turns: 10
  max_budget_usd: 1
  timeout_seconds: 300

verify:
  commands:
    - git diff --check

expect:
  changed_files:
    allow:
      - canary-proof.txt
    deny: []
  files_exist:
    - canary-proof.txt
  files_absent: []
  file_contains:
    - path: canary-proof.txt
      text: CANARY_OK

limits:
  max_tool_calls: 30
  max_total_tokens: 100000
  max_cost_usd: 1
`;
