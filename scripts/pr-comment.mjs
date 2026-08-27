import { readFile } from 'node:fs/promises';
import process from 'node:process';

export const COMMENT_MARKER = '<!-- claude-code-canary-pr-check -->';
const COMMENT_LIMIT = 65_000;
const COMMENTS_PER_PAGE = 100;
const MAX_COMMENT_PAGES = 10;

export function pullRequestNumberFromEvent(event) {
  const value = event?.pull_request?.number ?? event?.issue?.number ?? event?.number;
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

export function buildCommentBody(report, runUrl = '') {
  const footer = runUrl ? `\n\n---\n[View Canary workflow run](${runUrl})` : '';
  const body = `${COMMENT_MARKER}\n${String(report).trim()}${footer}\n`;
  if (body.length <= COMMENT_LIMIT) return body;
  return `${body.slice(0, COMMENT_LIMIT - 160)}\n\n_Report truncated in PR comment. Open the workflow run/artifact for the complete report._${footer}\n`;
}

function isBotComment(comment) {
  const login = typeof comment?.user?.login === 'string' ? comment.user.login : '';
  return comment?.user?.type === 'Bot' || /\[bot\]$/i.test(login);
}

export function findExistingCanaryComment(comments) {
  if (!Array.isArray(comments)) return undefined;
  return comments.find((comment) =>
    isBotComment(comment)
    && typeof comment?.body === 'string'
    && comment.body.includes(COMMENT_MARKER));
}

async function githubRequest(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : undefined; } catch { body = text; }
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'message' in body ? body.message : `${response.status} ${response.statusText}`;
    const error = new Error(`GitHub API ${response.status}: ${message}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

async function findExistingComment(commentsUrl, token) {
  for (let page = 1; page <= MAX_COMMENT_PAGES; page += 1) {
    const comments = await githubRequest(`${commentsUrl}?per_page=${COMMENTS_PER_PAGE}&page=${page}`, token);
    const existing = findExistingCanaryComment(comments);
    if (existing) return existing;
    if (!Array.isArray(comments) || comments.length < COMMENTS_PER_PAGE) return undefined;
  }
  return undefined;
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  const reportPath = process.env.CANARY_REPORT_PATH;
  if (!token) throw new Error('GITHUB_TOKEN is unavailable. Grant pull-requests: write to enable comment-pr.');
  if (!repository || !/^[^/]+\/[^/]+$/.test(repository)) throw new Error('GITHUB_REPOSITORY is unavailable or invalid.');
  if (!reportPath) throw new Error('Canary did not produce a Markdown report to comment.');

  let event = {};
  if (process.env.GITHUB_EVENT_PATH) {
    try { event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8')); } catch { event = {}; }
  }
  const explicit = Number(process.env.CANARY_PR_NUMBER || 0);
  const prNumber = Number.isInteger(explicit) && explicit > 0 ? explicit : pullRequestNumberFromEvent(event);
  if (!prNumber) throw new Error('No pull request number is available for comment-pr.');

  const report = await readFile(reportPath, 'utf8');
  const runUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : '';
  const body = buildCommentBody(report, runUrl);
  const apiBase = process.env.GITHUB_API_URL || 'https://api.github.com';
  const commentsUrl = `${apiBase}/repos/${repository}/issues/${prNumber}/comments`;

  try {
    const existing = await findExistingComment(commentsUrl, token);
    if (existing?.id) {
      await githubRequest(`${apiBase}/repos/${repository}/issues/comments/${existing.id}`, token, {
        method: 'PATCH',
        body: JSON.stringify({ body }),
      });
      console.log(`Updated Claude Canary PR comment #${existing.id}.`);
    } else {
      await githubRequest(commentsUrl, token, { method: 'POST', body: JSON.stringify({ body }) });
      console.log(`Created Claude Canary PR comment on #${prNumber}.`);
    }
  } catch (error) {
    if (error?.status === 403) {
      console.warn('Claude Canary could not write the PR comment (403). Grant pull-requests: write; fork PR tokens may remain read-only.');
      return;
    }
    throw error;
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('pr-comment.mjs')) {
  main().catch((error) => {
    console.error(`claude-canary PR comment: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
