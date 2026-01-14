import path from 'path';

// Paths
export const DATA_DIR = path.join(process.cwd(), 'data');
export const LOOPS_DIR = path.join(DATA_DIR, 'loops');
export const STATE_FILE = path.join(DATA_DIR, 'state.json');

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

// Loop settings
export const MAX_ITERATIONS_DEFAULT = 100;
export const STUCK_TIMEOUT_MINUTES = 5;

// Completion promise tag
export const COMPLETION_PROMISE = '<promise>TASK COMPLETE</promise>';
