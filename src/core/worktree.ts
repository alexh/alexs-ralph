import { spawn, spawnSync } from 'child_process';

/**
 * Check if wt (worktrunk) CLI is available
 */
export function isWorktreeAvailable(): boolean {
  try {
    const result = spawnSync('wt', ['--version'], { encoding: 'utf-8' });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Query git for the actual path of a worktree by branch name
 */
function getWorktreePathFromGit(branchName: string): string | null {
  try {
    const result = spawnSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: process.cwd(),
      encoding: 'utf-8',
    });

    if (result.status !== 0) {
      return null;
    }

    // Parse porcelain output - format is blocks separated by blank lines
    // Each block: worktree <path>\nHEAD <sha>\nbranch refs/heads/<branch>
    const blocks = result.stdout.split('\n\n');
    for (const block of blocks) {
      const lines = block.trim().split('\n');
      let worktreePath: string | null = null;
      let branch: string | null = null;

      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          worktreePath = line.substring(9);
        } else if (line.startsWith('branch refs/heads/')) {
          branch = line.substring(18);
        }
      }

      if (branch === branchName && worktreePath) {
        return worktreePath;
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Generate worktree branch name for a loop
 */
export function getWorktreeBranchName(loopId: string): string {
  // Shorten loop ID for cleaner branch names
  const shortId = loopId.replace('loop_', '').substring(0, 12);
  return `alex-${shortId}`;
}

/**
 * Create a worktree for a loop
 * Returns the worktree path (queried from git after creation)
 */
export async function createWorktree(
  loopId: string,
  baseBranch?: string
): Promise<{ worktreePath: string; worktreeBranch: string }> {
  const branchName = getWorktreeBranchName(loopId);

  // Check if worktree already exists by querying git
  const existingPath = getWorktreePathFromGit(branchName);
  if (existingPath) {
    return { worktreePath: existingPath, worktreeBranch: branchName };
  }

  return new Promise((resolve, reject) => {
    const args = ['switch', '--create', branchName, '--yes'];
    if (baseBranch) {
      args.push('--base', baseBranch);
    }

    const proc = spawn('wt', args, {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        // Query git for the actual worktree path (wt may put it anywhere based on config)
        const actualPath = getWorktreePathFromGit(branchName);
        if (actualPath) {
          resolve({ worktreePath: actualPath, worktreeBranch: branchName });
        } else {
          reject(new Error(`Worktree created but path not found in git worktree list`));
        }
      } else {
        reject(new Error(`Failed to create worktree: ${stderr}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn wt: ${err.message}`));
    });
  });
}

/**
 * Remove a worktree for a loop
 */
export async function removeWorktree(branchName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('wt', ['remove', branchName], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        // Don't fail if worktree doesn't exist
        if (stderr.includes('not found') || stderr.includes('does not exist')) {
          resolve();
        } else {
          reject(new Error(`Failed to remove worktree: ${stderr}`));
        }
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn wt: ${err.message}`));
    });
  });
}

/**
 * Get current HEAD commit SHA in a directory
 */
export function getHeadCommit(workingDir: string): string | null {
  try {
    const result = spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd: workingDir,
      encoding: 'utf-8',
    });
    if (result.status === 0) {
      return result.stdout.trim();
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Get git diff from a start commit to current state
 * Includes both committed and uncommitted changes
 */
export function getGitDiff(workingDir: string, startCommit?: string): string {
  try {
    let diff = '';

    // Get committed changes since startCommit
    if (startCommit) {
      const committedResult = spawnSync('git', ['diff', `${startCommit}..HEAD`], {
        cwd: workingDir,
        encoding: 'utf-8',
        maxBuffer: 1024 * 1024 * 10, // 10MB
      });
      if (committedResult.status === 0) {
        diff += committedResult.stdout;
      }
    }

    // Get uncommitted changes (staged + unstaged)
    const uncommittedResult = spawnSync('git', ['diff', 'HEAD'], {
      cwd: workingDir,
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024 * 10, // 10MB
    });
    if (uncommittedResult.status === 0 && uncommittedResult.stdout.trim()) {
      if (diff) {
        diff += '\n\n--- Uncommitted changes ---\n\n';
      }
      diff += uncommittedResult.stdout;
    }

    return diff || 'No changes detected';
  } catch (err) {
    return `Error getting diff: ${err}`;
  }
}

/**
 * Get a summary of files changed
 */
export function getChangedFilesSummary(workingDir: string, startCommit?: string): string {
  try {
    const args = startCommit
      ? ['diff', '--stat', `${startCommit}..HEAD`]
      : ['diff', '--stat', 'HEAD'];

    const result = spawnSync('git', args, {
      cwd: workingDir,
      encoding: 'utf-8',
    });

    if (result.status === 0) {
      return result.stdout.trim() || 'No files changed';
    }
    return 'Unable to get changed files';
  } catch {
    return 'Error getting changed files';
  }
}

/**
 * List all worktrees using git (more reliable than wt list)
 */
export function listWorktrees(): { path: string; branch: string }[] {
  try {
    const result = spawnSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: process.cwd(),
      encoding: 'utf-8',
    });

    if (result.status !== 0) {
      return [];
    }

    const worktrees: { path: string; branch: string }[] = [];
    const blocks = result.stdout.split('\n\n');

    for (const block of blocks) {
      const lines = block.trim().split('\n');
      let worktreePath: string | null = null;
      let branch: string | null = null;

      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          worktreePath = line.substring(9);
        } else if (line.startsWith('branch refs/heads/')) {
          branch = line.substring(18);
        }
      }

      if (worktreePath && branch) {
        worktrees.push({ path: worktreePath, branch });
      }
    }

    return worktrees;
  } catch {
    return [];
  }
}
