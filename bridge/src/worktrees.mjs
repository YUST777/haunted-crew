import { execFile } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

// Per-run git worktrees and a gated, off-tree merge (AgentCraft's design): agents work on their own
// branch `haunted-crew/<id>` in a separate folder, the user reviews the diff, and only then is the
// result merged. The merge commit is built inside git's object database (merge-tree + commit-tree),
// so the user's checkout is only ever fast-forwarded, never conflicted or half-merged.

async function git(cwd, args, { allowFail = false, env } = {}) {
  try {
    const { stdout } = await run('git', ['-c', 'core.autocrlf=false', ...args], { cwd, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, ...env } });
    return { code: 0, stdout: stdout.trimEnd(), stderr: '' };
  } catch (err) {
    if (!allowFail) throw new Error(`git ${args[0]}: ${String(err.stderr || err.message).trim().split('\n').slice(-2).join(' ')}`);
    return { code: typeof err.code === 'number' ? err.code : 1, stdout: String(err.stdout ?? '').trimEnd(), stderr: String(err.stderr ?? '') };
  }
}

export class MergeError extends Error {
  constructor(code, message, files = []) {
    super(message);
    this.code = code; // 'dirty' | 'conflict' | 'empty' | 'refused' | 'failed'
    this.files = files;
  }
}

export async function isGitRepo(dir) {
  return (await git(dir, ['rev-parse', '--is-inside-work-tree'], { allowFail: true })).stdout === 'true';
}

/** repo: the user's project folder; store: where worktree folders live (default <repo>/.haunted-crew/worktrees). */
export function createWorktrees({ repo, store = join(resolve(repo), '.haunted-crew', 'worktrees') }) {
  const items = new Map(); // id -> { id, branch, base, path, status }
  const serial = []; // one git write at a time per repo
  const queue = (fn) => {
    const p = (serial[0] ?? Promise.resolve()).then(fn, fn);
    serial[0] = p.catch(() => {});
    return p;
  };

  const need = (id) => {
    const w = items.get(id);
    if (!w) throw new MergeError('refused', `no worktree ${id}`);
    return w;
  };

  async function create(id) {
    return queue(async () => {
      if (items.has(id)) return items.get(id);
      const base = (await git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout;
      if (base === 'HEAD') throw new MergeError('refused', 'the project is on a detached HEAD; check out a branch first');
      const branch = `haunted-crew/${id}`;
      const path = join(store, id);
      mkdirSync(store, { recursive: true });
      await git(repo, ['worktree', 'prune'], { allowFail: true });
      await git(repo, ['worktree', 'add', '-b', branch, path, base]);
      const w = { id, branch, base, path, status: 'active' };
      items.set(id, w);
      return w;
    });
  }

  /** Commits whatever the agents left in the worktree, so the branch holds the work. */
  async function commitAll(w, message) {
    await git(w.path, ['add', '-A']);
    if ((await git(w.path, ['status', '--porcelain'])).stdout) {
      await git(w.path, ['-c', 'user.name=Haunted Crew', '-c', 'user.email=crew@haunted.local', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', message]);
    }
  }

  async function summary(w) {
    const range = `${w.base}...${w.branch}`;
    const stat = (await git(repo, ['diff', '--numstat', range])).stdout.split('\n').filter(Boolean).map((l) => l.split('\t'));
    return {
      id: w.id, branch: w.branch, base: w.base, status: w.status,
      files: stat.length,
      additions: stat.reduce((n, s) => n + (Number(s[0]) || 0), 0),
      deletions: stat.reduce((n, s) => n + (Number(s[1]) || 0), 0),
      names: stat.map((s) => s[2]).slice(0, 30),
    };
  }

  async function isDirty(dir) {
    return Boolean((await git(dir, ['status', '--porcelain', '--untracked-files=no'])).stdout);
  }

  async function check(w) {
    if (w.status !== 'active') return { ok: false, code: 'refused', reason: `worktree ${w.id} is ${w.status}` };
    if (await isDirty(repo)) return { ok: false, code: 'dirty', reason: `the project has uncommitted changes on ${w.base}: commit or stash them, then approve again` };
    const mt = await git(repo, ['merge-tree', '--write-tree', '--name-only', '--no-messages', w.base, w.branch], { allowFail: true });
    if (mt.code === 1) {
      const files = mt.stdout.split('\n').slice(1).filter(Boolean);
      return { ok: false, code: 'conflict', reason: `merging would conflict in: ${files.join(', ') || '(unknown files)'}`, files };
    }
    if (mt.code !== 0) return { ok: false, code: 'failed', reason: `merge-tree failed: ${mt.stderr.trim()}` };
    return { ok: true };
  }

  return {
    create,
    get: (id) => items.get(id) ?? null,
    isActive: (id) => items.get(id)?.status === 'active',

    /** Commits the work and reports what changed; null when the agents changed nothing. */
    async finish(id, message = 'Haunted Crew run') {
      return queue(async () => {
        const w = need(id);
        await commitAll(w, message);
        const s = await summary(w);
        return s.files ? s : null;
      });
    },

    summary: (id) => queue(async () => summary(need(id))),
    diff: (id) => queue(async () => (await git(repo, ['diff', '--no-color', `${need(id).base}...${need(id).branch}`])).stdout),
    canMerge: (id) => queue(async () => check(need(id))),

    /** Off-tree merge: build the merge commit in git's database, then fast-forward the user's branch. */
    merge: (id, message) => queue(async () => {
      const w = need(id);
      await commitAll(w, message ?? 'Haunted Crew run');
      const c = await check(w);
      if (!c.ok) throw new MergeError(c.code, c.reason, c.files);
      const ahead = Number((await git(repo, ['rev-list', '--count', `${w.base}..${w.branch}`])).stdout);
      if (!ahead) throw new MergeError('empty', `${w.branch} has no changes to merge`);
      const baseSha = (await git(repo, ['rev-parse', `refs/heads/${w.base}`])).stdout;
      const branchSha = (await git(repo, ['rev-parse', `refs/heads/${w.branch}`])).stdout;
      const tree = (await git(repo, ['merge-tree', '--write-tree', '--no-messages', w.base, w.branch])).stdout.split('\n')[0].trim();
      const msg = `Merge ${w.branch} into ${w.base}\n\nApproved in Haunted Crew.`;
      const ct = await git(repo, ['-c', 'commit.gpgsign=false', 'commit-tree', tree, '-p', baseSha, '-p', branchSha, '-m', msg], { allowFail: true });
      if (ct.code !== 0) throw new MergeError('failed', `could not create the merge commit: ${ct.stderr.trim()}`);
      const ff = await git(repo, ['merge', '--ff-only', '-q', ct.stdout], { allowFail: true });
      if (ff.code !== 0) throw new MergeError('refused', `could not update ${w.base}: ${ff.stderr.trim().split('\n').pop()}`);
      w.status = 'merged';
      await git(repo, ['worktree', 'remove', '--force', w.path], { allowFail: true });
      return { sha: ct.stdout.slice(0, 7), base: w.base, branch: w.branch };
    }),

    /** Drops the worktree folder and its branch (reject, or nothing to review). */
    discard: (id) => queue(async () => {
      const w = need(id);
      w.status = 'discarded';
      await git(repo, ['worktree', 'remove', '--force', w.path], { allowFail: true });
      await git(repo, ['branch', '-D', w.branch], { allowFail: true });
      return { ok: true };
    }),

    exists: (id) => existsSync(items.get(id)?.path ?? ''),
  };
}
