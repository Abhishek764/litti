/**
 * Reads what an agent changed in a git working tree: tracked edits against HEAD
 * plus new untracked files, split per file with line counts.
 *
 * Runs git with execFile (no shell). The repository path comes from operator
 * config (LITTI_REPO_PATH), never from a request.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

export interface ChangedFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'binary';
  added: number;
  removed: number;
  diff: string;
}

export interface Changes {
  repo: string;
  branch: string;
  head: string;
  files: ChangedFile[];
  /** All file diffs joined: what gets sent for review. */
  diff: string;
  /** Hash of `diff`: lets the page refresh only when something changed. */
  version: string;
  truncated: boolean;
}

const MAX_BYTES = 512 * 1024;
const MAX_UNTRACKED = 200;

function git(repo: string, args: string[], okCodes = [0]): Promise<string> {
  return new Promise((res, rej) => {
    execFile('git', ['-C', repo, '-c', 'core.quotepath=off', ...args], { maxBuffer: 8 * 1024 * 1024, windowsHide: true, timeout: 15000 }, (err, stdout) => {
      const code = err ? (typeof (err as any).code === 'number' ? (err as any).code : -1) : 0;
      if (err && !okCodes.includes(code)) rej(new Error(`git ${args[0]} failed`));
      else res(stdout);
    });
  });
}

/** Repository to watch: LITTI_REPO_PATH, else the server's working directory. */
export function repoPath(env = process.env): string {
  return resolve(env.LITTI_REPO_PATH || process.cwd());
}

/** Split a combined `git diff` into one entry per file. */
export function splitDiff(diff: string): ChangedFile[] {
  const parts = diff.split(/^(?=diff --git )/m).filter(p => p.startsWith('diff --git '));
  return parts.map(part => {
    const lines = part.replace(/\n$/, '').split('\n');
    const header = lines[0].match(/^diff --git a\/(.+?) b\/(.+)$/);
    let path = header?.[2] ?? 'unknown';
    let status: ChangedFile['status'] = 'modified';
    for (const l of lines.slice(1, 6)) {
      if (l.startsWith('new file mode')) status = 'added';
      else if (l.startsWith('deleted file mode')) { status = 'deleted'; path = header?.[1] ?? path; }
      else if (l.startsWith('rename to ')) { status = 'renamed'; path = l.slice('rename to '.length); }
      else if (l.startsWith('Binary files')) status = 'binary';
    }
    if (lines.some(l => /^Binary files .* differ$/.test(l))) status = 'binary';
    let added = 0, removed = 0, inHunk = false;
    for (const l of lines) {
      if (l.startsWith('@@')) { inHunk = true; continue; }
      if (!inHunk) continue;
      if (l.startsWith('+')) added++;
      else if (l.startsWith('-')) removed++;
    }
    return { path, status, added, removed, diff: lines.join('\n') };
  });
}

/** Everything that differs from HEAD in the repo, including untracked files. */
export async function readChanges(repo = repoPath()): Promise<Changes> {
  const inside = (await git(repo, ['rev-parse', '--is-inside-work-tree']).catch(() => '')).trim();
  if (inside !== 'true') throw new Error(`Not a git repository: ${repo}`);

  const hasHead = await git(repo, ['rev-parse', '--verify', '-q', 'HEAD']).then(() => true, () => false);
  const branch = (await git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => 'HEAD')).trim();
  const head = hasHead ? (await git(repo, ['rev-parse', '--short', 'HEAD'])).trim() : '(no commits)';

  // Tracked changes (staged + unstaged) against HEAD; before the first commit, against the index.
  let combined = hasHead
    ? await git(repo, ['diff', 'HEAD', '--no-color', '--no-ext-diff', '-M'])
    : await git(repo, ['diff', '--cached', '--no-color', '--no-ext-diff']);

  // Untracked files show up as whole-file additions.
  const untracked = (await git(repo, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean);
  let truncated = untracked.length > MAX_UNTRACKED;
  for (const f of untracked.slice(0, MAX_UNTRACKED)) {
    if (Buffer.byteLength(combined) > MAX_BYTES) { truncated = true; break; }
    // Exit code 1 means "differs", which is the expected result here.
    combined += await git(repo, ['diff', '--no-color', '--no-ext-diff', '--no-index', '--', '/dev/null', f], [0, 1]).catch(() => '');
  }
  if (Buffer.byteLength(combined) > MAX_BYTES) {
    combined = Buffer.from(combined).subarray(0, MAX_BYTES).toString('utf8').replace(/\n[^\n]*$/, '\n');
    truncated = true;
  }

  const files = splitDiff(combined);
  const diff = files.map(f => f.diff).join('\n');
  return {
    repo, branch, head, files, diff, truncated,
    version: createHash('sha256').update(diff).digest('hex').slice(0, 16),
  };
}
