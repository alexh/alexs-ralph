import { colors } from '../config.js';

// Blessed style objects for consistent theming
// Note: blessed accepts hex color strings at runtime even though types say number

export const statusColors: Record<string, string> = {
  running: colors.running,
  paused: colors.paused,
  completed: colors.completed,
  error: colors.error,
  queued: colors.queued,
  stopped: colors.stopped,
};

export const statusIcons: Record<string, string> = {
  running: '●',
  paused: '◐',
  completed: '✓',
  error: '✗',
  queued: '○',
  stopped: '◼',
};
