import path from 'path';
import os from 'os';
import fs from 'fs';
import { parse as parseYaml } from 'yaml';

// User config path
export const ALEX_DIR = path.join(os.homedir(), '.alex');
export const ALEX_CONFIG_FILE = path.join(ALEX_DIR, 'config.yaml');
export const ALEX_WORKTREES_DIR = path.join(ALEX_DIR, 'worktrees');

// Data paths (stored in user home dir)
export const DATA_DIR = path.join(ALEX_DIR, 'data');
export const LOOPS_DIR = path.join(DATA_DIR, 'loops');
export const STATE_FILE = path.join(DATA_DIR, 'state.json');

// User config schema
interface UserConfig {
  worktrees?: {
    enabled?: boolean;
    baseDir?: string;
  };
  loops?: {
    maxIterations?: number;
    iterationTimeoutMs?: number;
    autoCompleteOnCriteria?: boolean;
  };
  stuckDetection?: {
    enabled?: boolean;
    thresholdMinutes?: number;
  };
  ui?: {
    showHidden?: boolean;
    logTailLines?: number;
    scrollingText?: boolean;
  };
}

// Load user config from ~/.alex/config.yaml
function loadUserConfig(): UserConfig {
  try {
    if (fs.existsSync(ALEX_CONFIG_FILE)) {
      const content = fs.readFileSync(ALEX_CONFIG_FILE, 'utf-8');
      return parseYaml(content) as UserConfig || {};
    }
  } catch (err) {
    console.error(`Warning: Failed to load ${ALEX_CONFIG_FILE}:`, err);
  }
  return {};
}

// Load user config once at startup
const userConfig = loadUserConfig();

// Theme colors (Cyberpunk/Vaporwave)
export const colors = {
  bg: '#0b0b0f',
  bgPanel: '#1a1a1f',
  text: '#eaeaea',
  textDim: '#666666',

  // Neon accents
  pink: '#ff4fd8',
  cyan: '#2de2e6',
  purple: '#9b5de5',

  // Border
  border: '#444444',

  // Status colors
  running: '#2de2e6',   // cyan
  paused: '#ffbe0b',    // yellow
  completed: '#00f5d4', // teal
  error: '#ff006e',     // red
  queued: '#666666',    // dim
  stopped: '#666666',   // dim
} as const;

// Agent CLI commands
export const AGENT_COMMANDS = {
  claude: 'claude --dangerously-skip-permissions',
  claude_safe: 'claude',
  codex: 'codex exec',
} as const;

// Tab names
export const TABS = ['All', 'Running', 'Paused', 'Completed', 'Errors'] as const;

// Loop settings (with user config overrides)
export const MAX_ITERATIONS_DEFAULT = userConfig.loops?.maxIterations ?? 20;
export const STUCK_TIMEOUT_MINUTES = userConfig.stuckDetection?.thresholdMinutes ?? 5;
export const AUTO_COMPLETE_ON_CRITERIA = userConfig.loops?.autoCompleteOnCriteria ?? true;
export const WORKTREES_ENABLED = userConfig.worktrees?.enabled ?? true;
export const STUCK_DETECTION_ENABLED = userConfig.stuckDetection?.enabled ?? true;
export const SCROLLING_TEXT_ENABLED = userConfig.ui?.scrollingText ?? false;

// Circuit breaker thresholds
export const CB_NO_PROGRESS_THRESHOLD = 3;        // Open after N loops with no file changes
export const CB_SAME_ERROR_THRESHOLD = 5;         // Open after N loops with same errors
export const CB_OUTPUT_DECLINE_THRESHOLD = 0.7;   // Open if output declines >70%
export const CB_CONSECUTIVE_TEST_THRESHOLD = 3;   // Exit after N consecutive test-only loops

// Rate limiting
export const RATE_LIMIT_CALLS_PER_HOUR = 100;

// Timeouts
export const ITERATION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes per iteration

// Completion promise tag
export const COMPLETION_PROMISE = '<promise>TASK COMPLETE</promise>';

// Ralph status block patterns
export const RALPH_STATUS_REGEX = /---RALPH_STATUS---[\s\S]*?STATUS:\s*(.*?)[\s\S]*?EXIT_SIGNAL:\s*(true|false)/i;

// Detection patterns
export const COMPLETION_PATTERNS = [
  /\bdone\b/i,
  /\bcomplete[d]?\b/i,
  /\bfinished\b/i,
  /all tasks complete/i,
  /project complete/i,
  /ready for review/i,
];

export const TEST_ONLY_PATTERNS = [
  /running tests/i,
  /npm test/i,
  /bun test/i,
  /pytest/i,
  /jest/i,
  /cargo test/i,
  /go test/i,
  /bats/i,
];

export const IMPLEMENTATION_PATTERNS = [
  /implementing/i,
  /creating/i,
  /writing/i,
  /adding/i,
  /\bfunction\b/i,
  /\bclass\b/i,
  /refactoring/i,
  /fixing/i,
];

export const NO_WORK_PATTERNS = [
  /nothing to do/i,
  /no changes/i,
  /already implemented/i,
  /up to date/i,
];

// Metrics dashboard settings
export const METRICS_TREND_DAYS = 14;
export const METRICS_TREND_WEEKS = 8;
export const METRICS_TOP_FAILURES = 5;
