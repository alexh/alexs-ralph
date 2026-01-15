import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { listWorktrees, removeWorktree, getWorktreeBranchName } from './core/worktree.js';
import { loadState } from './core/index.js';

// User config file location
const ALEX_DIR = path.join(os.homedir(), '.alex');
const USER_CONFIG_FILE = path.join(ALEX_DIR, 'config.json');

// Config type
export interface UserConfig {
  defaultAgent?: string;
  maxIterations?: number;
  worktreeBase?: string;
  autoComplete?: boolean;
  stuckTimeoutMinutes?: number;
  theme?: 'dark' | 'light';
  editor?: string;
  transparency?: boolean;
  scrollingText?: boolean;
  tutorialCompleted?: boolean;
}

// Defaults
const DEFAULT_CONFIG: Required<UserConfig> = {
  defaultAgent: 'claude',
  maxIterations: 20,
  worktreeBase: path.join(os.homedir(), '.alex', 'worktrees'),
  autoComplete: true,
  stuckTimeoutMinutes: 5,
  theme: 'dark',
  editor: 'code',
  transparency: true,
  scrollingText: false,
  tutorialCompleted: false,
};

// Config key to CLI flag mapping
const FLAG_TO_KEY: Record<string, keyof UserConfig> = {
  '--default-agent': 'defaultAgent',
  '--max-iterations': 'maxIterations',
  '--worktree-base': 'worktreeBase',
  '--auto-complete': 'autoComplete',
  '--stuck-timeout': 'stuckTimeoutMinutes',
  '--theme': 'theme',
  '--editor': 'editor',
  '--transparency': 'transparency',
  '--scrolling-text': 'scrollingText',
};

/**
 * Load user config from ~/.alex/config.json
 */
export function loadUserConfig(): UserConfig {
  try {
    if (fs.existsSync(USER_CONFIG_FILE)) {
      const content = fs.readFileSync(USER_CONFIG_FILE, 'utf-8');
      return JSON.parse(content);
    }
  } catch {
    // Ignore parse errors, return empty
  }
  return {};
}

/**
 * Save user config to ~/.alex/config.json
 */
export function saveUserConfig(config: UserConfig): void {
  // Ensure directory exists
  if (!fs.existsSync(ALEX_DIR)) {
    fs.mkdirSync(ALEX_DIR, { recursive: true });
  }
  fs.writeFileSync(USER_CONFIG_FILE, JSON.stringify(config, null, 2));
}

/**
 * Get merged config (user + defaults)
 */
export function getConfig(): Required<UserConfig> {
  const user = loadUserConfig();
  return { ...DEFAULT_CONFIG, ...user };
}

/**
 * Mark tutorial as completed
 */
export function markTutorialCompleted(): void {
  const config = loadUserConfig();
  config.tutorialCompleted = true;
  saveUserConfig(config);
}

/**
 * Check if tutorial should show
 */
export function shouldShowTutorial(flags: Record<string, string | boolean>): boolean {
  // Force show if --tutorial flag
  if (flags['--tutorial']) return true;
  // Show if not completed
  const config = getConfig();
  return !config.tutorialCompleted;
}

/**
 * Parse command line arguments
 */
export function parseArgs(): { command: 'tui' | 'configure' | 'clean' | 'uninstall' | 'help'; flags: Record<string, string | boolean> } {
  const args = process.argv.slice(2);
  const flags: Record<string, string | boolean> = {};

  // Find first non-flag argument as command
  let command: string | undefined;
  let startIdx = 0;
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('--')) {
      command = args[i];
      startIdx = i + 1;
      break;
    }
  }

  // Parse all flags (before and after command)
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const nextArg = args[i + 1];
      // Boolean flags
      if (arg === '--list' || arg === '--dry-run' || arg === '--force' || arg === '--tutorial') {
        flags[arg] = true;
      } else if (nextArg && !nextArg.startsWith('--')) {
        flags[arg] = nextArg;
        i++;
      }
    }
  }

  if (!command) {
    return { command: 'tui', flags };
  }

  if (command === 'configure' || command === 'config') {
    return { command: 'configure', flags };
  }

  if (command === 'clean') {
    return { command: 'clean', flags };
  }

  if (command === 'uninstall') {
    return { command: 'uninstall', flags };
  }

  if (command === 'help' || command === '--help' || command === '-h') {
    return { command: 'help', flags };
  }

  // Unknown command, show help
  return { command: 'help', flags };
}

/**
 * Run configure command
 */
export function runConfigure(flags: Record<string, string | boolean>): void {
  // Show current config
  if (flags['--list'] || Object.keys(flags).length === 0) {
    const config = getConfig();
    const userConfig = loadUserConfig();
    console.log('\n  alex configuration\n');
    console.log('  Location: ' + USER_CONFIG_FILE + '\n');

    for (const [key, value] of Object.entries(config)) {
      const isCustom = key in userConfig;
      const marker = isCustom ? '*' : ' ';
      console.log(`  ${marker} ${key}: ${value}`);
    }
    console.log('\n  (* = custom value)\n');
    return;
  }

  // Update config values
  const config = loadUserConfig();
  let updated = false;

  for (const [flag, key] of Object.entries(FLAG_TO_KEY)) {
    if (flag in flags) {
      const value = flags[flag];

      // Type coercion based on key
      if (key === 'maxIterations' || key === 'stuckTimeoutMinutes') {
        config[key] = parseInt(value as string, 10);
      } else if (key === 'autoComplete' || key === 'transparency' || key === 'scrollingText') {
        config[key] = value === 'on' || value === 'true' || value === true;
      } else if (key === 'theme') {
        if (value === 'dark' || value === 'light') {
          config[key] = value;
        } else {
          console.error(`Invalid theme: ${value}. Use 'dark' or 'light'.`);
          process.exit(1);
        }
      } else {
        (config as any)[key] = value;
      }
      updated = true;
    }
  }

  if (updated) {
    saveUserConfig(config);
    console.log('\n  Configuration updated.\n');
    runConfigure({ '--list': true });
  }
}

/**
 * Run clean command - remove orphaned worktrees
 */
export async function runClean(flags: Record<string, string | boolean>): Promise<void> {
  const dryRun = flags['--dry-run'] === true;
  const force = flags['--force'] === true;

  console.log('\n  Scanning for orphaned worktrees...\n');

  // Get all worktrees
  const worktrees = listWorktrees();
  const alexWorktrees = worktrees.filter(wt => wt.branch.startsWith('alex-'));

  if (alexWorktrees.length === 0) {
    console.log('  No alex worktrees found.\n');
    return;
  }

  // Get active loop IDs from state
  const state = loadState();
  const activeStatuses = ['running', 'paused', 'queued'];
  const activeLoopIds = new Set(
    state.loops
      .filter(loop => activeStatuses.includes(loop.status))
      .map(loop => getWorktreeBranchName(loop.id))
  );

  // Find orphaned worktrees
  const orphaned = alexWorktrees.filter(wt => !activeLoopIds.has(wt.branch));

  if (orphaned.length === 0) {
    console.log('  No orphaned worktrees found.\n');
    return;
  }

  // Calculate size
  let totalSize = 0;
  for (const wt of orphaned) {
    try {
      const result = spawnSync('du', ['-sk', wt.path], { encoding: 'utf-8' });
      if (result.status === 0) {
        const kb = parseInt(result.stdout.split('\t')[0], 10);
        totalSize += kb;
      }
    } catch {
      // Ignore size calculation errors
    }
  }

  const sizeMb = (totalSize / 1024).toFixed(1);

  console.log(`  Found ${orphaned.length} orphaned worktree(s) (~${sizeMb}MB):\n`);
  for (const wt of orphaned) {
    console.log(`    - ${wt.branch} (${wt.path})`);
  }
  console.log('');

  if (dryRun) {
    console.log('  Dry run - no changes made.\n');
    return;
  }

  // Confirm unless --force
  if (!force) {
    const readline = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const answer = await new Promise<string>((resolve) => {
      rl.question('  Remove these worktrees? [y/N] ', resolve);
    });
    rl.close();

    if (answer.toLowerCase() !== 'y') {
      console.log('\n  Aborted.\n');
      return;
    }
  }

  // Remove worktrees
  console.log('\n  Removing worktrees...\n');
  let removed = 0;
  for (const wt of orphaned) {
    try {
      await removeWorktree(wt.branch);
      console.log(`    Removed ${wt.branch}`);
      removed++;
    } catch (err) {
      console.error(`    Failed to remove ${wt.branch}: ${err}`);
    }
  }

  console.log(`\n  Removed ${removed} worktree(s), freed ~${sizeMb}MB.\n`);
}

/**
 * Show help
 */
export function showHelp(): void {
  console.log(`
  alex - AI loop orchestrator

  Usage:
    alex                Launch TUI
    alex --tutorial     Show tutorial/onboarding
    alex configure      View/set configuration
    alex clean          Remove orphaned worktrees
    alex uninstall      Remove alex completely
    alex help           Show this help

  Configure flags:
    --list              Show current configuration
    --default-agent     Default agent (claude, gemini, etc)
    --max-iterations    Default max iterations
    --worktree-base     Worktree base directory
    --auto-complete     Auto-complete on criteria (on/off)
    --stuck-timeout     Stuck timeout in minutes
    --theme             UI theme (dark/light)
    --editor            Preferred editor command
    --transparency      Transparent modal backgrounds (on/off)
    --scrolling-text    Marquee scroll for long loop titles (on/off)

  Clean flags:
    --dry-run           Show what would be removed
    --force             Skip confirmation prompt

  Examples:
    alex configure --default-agent gemini
    alex configure --theme light --transparency off
    alex clean --dry-run
`);
}
