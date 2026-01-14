import { RateLimiterState } from './types.js';
import { RATE_LIMIT_CALLS_PER_HOUR } from '../config.js';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Rate limiter to prevent excessive API calls.
 * Tracks calls per hour with automatic window reset.
 */

/**
 * Create initial rate limiter state.
 */
export function createRateLimiter(callsPerHour?: number): RateLimiterState {
  return {
    callCount: 0,
    windowStart: Date.now(),
    callsPerHour: callsPerHour ?? RATE_LIMIT_CALLS_PER_HOUR,
  };
}

/**
 * Check if a call is allowed under the rate limit.
 * Returns remaining calls if allowed, or -1 if rate limited.
 */
export function checkRateLimit(rl: RateLimiterState): number {
  const now = Date.now();

  // Check if window has expired and reset
  if (now - rl.windowStart >= HOUR_MS) {
    return rl.callsPerHour; // Full quota available
  }

  const remaining = rl.callsPerHour - rl.callCount;
  return remaining > 0 ? remaining : -1;
}

/**
 * Record a call and update rate limiter state.
 * Returns the new state (may reset window if expired).
 */
export function recordCall(rl: RateLimiterState): RateLimiterState {
  const now = Date.now();

  // Reset window if expired
  if (now - rl.windowStart >= HOUR_MS) {
    return {
      callCount: 1,
      windowStart: now,
      callsPerHour: rl.callsPerHour,
    };
  }

  return {
    ...rl,
    callCount: rl.callCount + 1,
  };
}

/**
 * Get time until rate limit window resets (ms).
 */
export function getTimeUntilReset(rl: RateLimiterState): number {
  const elapsed = Date.now() - rl.windowStart;
  return Math.max(0, HOUR_MS - elapsed);
}

/**
 * Format time until reset as HH:MM:SS.
 */
export function formatTimeUntilReset(rl: RateLimiterState): string {
  const ms = getTimeUntilReset(rl);
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Get rate limiter status summary for logging.
 */
export function getStatusSummary(rl: RateLimiterState): string {
  const remaining = checkRateLimit(rl);
  const resetIn = formatTimeUntilReset(rl);

  if (remaining < 0) {
    return `Rate limited! Resets in ${resetIn}`;
  }

  return `${remaining}/${rl.callsPerHour} calls remaining (resets in ${resetIn})`;
}

/**
 * Wait until rate limit allows another call.
 * Returns a promise that resolves when ready.
 */
export async function waitForRateLimit(rl: RateLimiterState): Promise<void> {
  const waitTime = getTimeUntilReset(rl);
  if (waitTime > 0) {
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
}
