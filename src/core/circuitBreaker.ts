import { CircuitBreakerState, CircuitState, AnalysisResult } from './types.js';
import {
  CB_NO_PROGRESS_THRESHOLD,
  CB_SAME_ERROR_THRESHOLD,
  CB_OUTPUT_DECLINE_THRESHOLD,
} from '../config.js';

/**
 * Circuit breaker to halt loops that are stuck or not making progress.
 * Based on ralph-claude-code's circuit_breaker.sh logic.
 *
 * States:
 * - CLOSED: Normal operation, progress is being made
 * - HALF_OPEN: Monitoring mode, checking for recovery
 * - OPEN: Execution halted, requires manual reset
 */

/**
 * Create initial circuit breaker state.
 */
export function createCircuitBreaker(): CircuitBreakerState {
  return {
    state: 'closed',
    consecutiveNoProgress: 0,
    consecutiveSameError: 0,
    consecutiveTestOnly: 0,
    lastErrors: [],
    lastOutputLength: 0,
  };
}

/**
 * Record a loop iteration result and update circuit breaker state.
 */
export function recordIteration(
  cb: CircuitBreakerState,
  analysis: AnalysisResult
): CircuitBreakerState {
  const newCb = { ...cb };

  // Track progress
  if (analysis.hasProgress || analysis.filesModified > 0) {
    // Progress detected - reset counters and recover
    newCb.consecutiveNoProgress = 0;
    newCb.consecutiveSameError = 0;

    // Recovery from half-open
    if (newCb.state === 'half_open') {
      newCb.state = 'closed';
      delete newCb.openReason;
      delete newCb.openedAt;
    }
  } else {
    // No progress
    newCb.consecutiveNoProgress++;
  }

  // Track test-only loops
  if (analysis.isTestOnly) {
    newCb.consecutiveTestOnly++;
  } else {
    newCb.consecutiveTestOnly = 0;
  }

  // Track same errors
  if (analysis.errors.length > 0) {
    const errorsMatch = areErrorsSame(newCb.lastErrors, analysis.errors);
    if (errorsMatch) {
      newCb.consecutiveSameError++;
    } else {
      newCb.consecutiveSameError = 1;
    }
    newCb.lastErrors = [...analysis.errors];
  } else {
    newCb.consecutiveSameError = 0;
    newCb.lastErrors = [];
  }

  // Track output decline
  const outputDecline = cb.lastOutputLength > 0
    ? 1 - (analysis.outputLength / cb.lastOutputLength)
    : 0;
  newCb.lastOutputLength = analysis.outputLength;

  // State transitions based on thresholds
  newCb.state = determineState(newCb, outputDecline);

  return newCb;
}

/**
 * Determine circuit breaker state based on current metrics.
 */
function determineState(
  cb: CircuitBreakerState,
  outputDecline: number
): CircuitState {
  // Already open stays open (manual reset required)
  if (cb.state === 'open') {
    return 'open';
  }

  // Check for open conditions
  if (cb.consecutiveNoProgress >= CB_NO_PROGRESS_THRESHOLD) {
    cb.openReason = `No progress for ${cb.consecutiveNoProgress} iterations`;
    cb.openedAt = new Date().toISOString();
    return 'open';
  }

  if (cb.consecutiveSameError >= CB_SAME_ERROR_THRESHOLD) {
    cb.openReason = `Same errors for ${cb.consecutiveSameError} iterations`;
    cb.openedAt = new Date().toISOString();
    return 'open';
  }

  if (outputDecline >= CB_OUTPUT_DECLINE_THRESHOLD) {
    cb.openReason = `Output declined by ${Math.round(outputDecline * 100)}%`;
    cb.openedAt = new Date().toISOString();
    return 'open';
  }

  // Check for half-open conditions (warning state)
  if (cb.consecutiveNoProgress >= 2) {
    return 'half_open';
  }

  return 'closed';
}

/**
 * Check if circuit breaker should halt execution.
 */
export function shouldHalt(cb: CircuitBreakerState): boolean {
  return cb.state === 'open';
}

/**
 * Get the reason why circuit breaker is open.
 */
export function getHaltReason(cb: CircuitBreakerState): string {
  return cb.openReason || 'Circuit breaker tripped';
}

/**
 * Manually reset circuit breaker to closed state.
 */
export function resetCircuitBreaker(cb: CircuitBreakerState): CircuitBreakerState {
  return {
    ...cb,
    state: 'closed',
    consecutiveNoProgress: 0,
    consecutiveSameError: 0,
    consecutiveTestOnly: 0,
    lastErrors: [],
    openReason: undefined,
    openedAt: undefined,
  };
}

/**
 * Check if two error arrays contain the same errors.
 */
function areErrorsSame(prev: string[], curr: string[]): boolean {
  if (prev.length === 0 || curr.length === 0) {
    return false;
  }

  // Check if all current errors appear in previous
  return curr.every(err =>
    prev.some(p => p.includes(err) || err.includes(p))
  );
}

/**
 * Get circuit breaker status summary for logging.
 */
export function getStatusSummary(cb: CircuitBreakerState): string {
  const parts = [
    `state=${cb.state}`,
    `no_progress=${cb.consecutiveNoProgress}`,
    `same_error=${cb.consecutiveSameError}`,
    `test_only=${cb.consecutiveTestOnly}`,
  ];

  if (cb.openReason) {
    parts.push(`reason="${cb.openReason}"`);
  }

  return parts.join(', ');
}
