import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { AnalysisResult } from './types.js';
import {
  COMPLETION_PROMISE,
  RALPH_STATUS_REGEX,
  COMPLETION_PATTERNS,
  TEST_ONLY_PATTERNS,
  IMPLEMENTATION_PATTERNS,
  NO_WORK_PATTERNS,
} from '../config.js';

/**
 * Git baseline info for progress detection.
 * Tracks initial dirty files AND their content hashes to detect further changes.
 */
export interface GitBaselineInfo {
  initialDirtyFiles: Set<string>;
  initialFileHashes: Map<string, string>;  // filename -> content hash
}

/**
 * Analyze agent output to detect completion, stuck state, and test-only signals.
 * Based on ralph-claude-code's response_analyzer.sh logic.
 * @param gitBaseline - Git baseline with initial dirty files and hashes to exclude
 */
export function analyzeResponse(output: string, workingDir: string, gitBaseline?: GitBaselineInfo | null): AnalysisResult {
  const result: AnalysisResult = {
    hasCompletionSignal: false,
    isTestOnly: false,
    isStuck: false,
    hasProgress: false,
    exitSignal: null,
    completionIndicators: 0,
    filesModified: 0,
    outputLength: output.length,
    errors: [],
    workSummary: '',
    confidenceScore: 0,
  };

  // 1. Check for explicit completion promise tag
  if (output.includes(COMPLETION_PROMISE)) {
    result.hasCompletionSignal = true;
    result.completionIndicators += 2;
    result.confidenceScore += 50;
  }

  // 2. Check for RALPH_STATUS block with EXIT_SIGNAL
  const statusMatch = output.match(RALPH_STATUS_REGEX);
  if (statusMatch) {
    result.exitSignal = statusMatch[2].toLowerCase() === 'true';
    if (result.exitSignal) {
      result.completionIndicators += 2;
      result.confidenceScore += 50;
    }
  }

  // 3. Count completion keyword indicators
  let completionKeywordCount = 0;
  for (const pattern of COMPLETION_PATTERNS) {
    if (pattern.test(output)) {
      completionKeywordCount++;
    }
  }
  if (completionKeywordCount >= 2) {
    result.completionIndicators++;
    result.confidenceScore += 10 * completionKeywordCount;
  }

  // 4. Check for no-work patterns
  for (const pattern of NO_WORK_PATTERNS) {
    if (pattern.test(output)) {
      result.completionIndicators++;
      result.confidenceScore += 15;
      break;
    }
  }

  // 5. Detect test-only vs implementation
  let testCommandCount = 0;
  let implementationCount = 0;

  for (const pattern of TEST_ONLY_PATTERNS) {
    const matches = output.match(new RegExp(pattern.source, 'gi'));
    if (matches) {
      testCommandCount += matches.length;
    }
  }

  for (const pattern of IMPLEMENTATION_PATTERNS) {
    const matches = output.match(new RegExp(pattern.source, 'gi'));
    if (matches) {
      implementationCount += matches.length;
    }
  }

  result.isTestOnly = testCommandCount > 0 && implementationCount === 0;

  // 6. Check git for file changes (progress detection)
  // Use baseline if provided to avoid false positives from pre-existing dirty state
  result.filesModified = countGitChanges(workingDir, gitBaseline);
  if (result.filesModified > 0) {
    result.hasProgress = true;
    result.confidenceScore += 20;
  }

  // 7. Extract errors (filter out JSON field false positives)
  result.errors = extractErrors(output);
  if (result.errors.length > 0) {
    result.confidenceScore -= 10;
  }

  // 8. Generate work summary (first 200 chars of meaningful content)
  result.workSummary = generateWorkSummary(output);

  // 9. Determine if stuck (no progress, no completion indicators, has errors)
  result.isStuck = !result.hasProgress &&
    result.completionIndicators === 0 &&
    result.errors.length > 0;

  return result;
}

/**
 * Count git-tracked file changes since the baseline.
 * Counts: (1) newly dirty files, (2) dirty files whose content changed since baseline.
 */
function countGitChanges(workingDir: string, gitBaseline?: GitBaselineInfo | null): number {
  try {
    const initialDirty = gitBaseline?.initialDirtyFiles ?? new Set<string>();
    const initialHashes = gitBaseline?.initialFileHashes ?? new Map<string, string>();

    // Get all currently changed files (staged + unstaged) - use execFileSync to avoid shell
    const changedFiles = execFileSync('git', ['diff', '--name-only', 'HEAD'], {
      cwd: workingDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim().split('\n').filter(f => f.length > 0);

    // Get staged files
    const stagedFiles = execFileSync('git', ['diff', '--name-only', '--cached'], {
      cwd: workingDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim().split('\n').filter(f => f.length > 0);

    // Get untracked files
    const untrackedFiles = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {
      cwd: workingDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim().split('\n').filter(f => f.length > 0);

    // Combine all current dirty files
    const allCurrentDirty = new Set([...changedFiles, ...stagedFiles, ...untrackedFiles]);

    let progressCount = 0;
    for (const file of allCurrentDirty) {
      if (!initialDirty.has(file)) {
        // Newly dirty file - counts as progress
        progressCount++;
      } else {
        // File was already dirty - check if content changed further
        const initialHash = initialHashes.get(file);
        if (initialHash) {
          const currentHash = getFileHash(workingDir, file);
          if (currentHash && currentHash !== initialHash) {
            // Content changed since baseline - counts as progress
            progressCount++;
          }
        }
      }
    }

    return progressCount;
  } catch {
    // Not a git repo or other error - can't determine progress
    return 0;
  }
}

/**
 * Get a hash of a file's current content.
 * Uses git hash-object (safe argv), falls back to fs-based SHA-256 hash.
 */
function getFileHash(workingDir: string, file: string): string | null {
  // Try git hash-object first (safe - no shell, passes file as argv)
  try {
    const hash = execFileSync('git', ['hash-object', '--', file], {
      cwd: workingDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return hash.trim();
  } catch {
    // git hash-object failed - fall back to fs-based hash
  }

  // Fallback: read file and compute SHA-256 hash
  try {
    const fullPath = join(workingDir, file);
    const content = readFileSync(fullPath);
    return createHash('sha256').update(content).digest('hex');
  } catch {
    // File doesn't exist, is a directory, or other error
    return null;
  }
}

/**
 * Extract actual error messages from output, filtering JSON field false positives.
 */
function extractErrors(output: string): string[] {
  const errors: string[] = [];
  const lines = output.split('\n');

  // Error patterns (excluding JSON field patterns like "is_error": false)
  const errorPatterns = [
    /^Error:/i,
    /^ERROR:/,
    /\]: error/i,
    /Error occurred/i,
    /failed with error/i,
    /[Ee]xception/,
    /Fatal/i,
    /FATAL/,
  ];

  // JSON field pattern to filter out
  const jsonFieldPattern = /"[^"]*error[^"]*"\s*:/i;

  for (const line of lines) {
    // Skip JSON field patterns
    if (jsonFieldPattern.test(line)) {
      continue;
    }

    for (const pattern of errorPatterns) {
      if (pattern.test(line)) {
        const trimmed = line.trim();
        if (trimmed.length > 0 && !errors.includes(trimmed)) {
          errors.push(trimmed);
        }
        break;
      }
    }
  }

  return errors;
}

/**
 * Generate a brief work summary from the output.
 */
function generateWorkSummary(output: string): string {
  // Try to find meaningful content after common prefixes
  const lines = output.split('\n');
  const meaningfulLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip empty lines, JSON, and common noise
    if (
      trimmed.length === 0 ||
      trimmed.startsWith('{') ||
      trimmed.startsWith('[') ||
      trimmed.startsWith('//') ||
      trimmed.length < 10
    ) {
      continue;
    }
    meaningfulLines.push(trimmed);
    if (meaningfulLines.length >= 3) {
      break;
    }
  }

  return meaningfulLines.join(' ').substring(0, 200);
}

/**
 * Determine if loop should exit based on analysis results.
 * Returns the exit reason or null if should continue.
 */
export function shouldExit(
  analysis: AnalysisResult,
  consecutiveTestOnly: number,
  testThreshold: number
): 'completion_signal' | 'exit_signal' | 'project_complete' | 'test_saturation' | null {
  // Priority 1: Explicit completion promise tag
  if (analysis.hasCompletionSignal) {
    return 'completion_signal';
  }

  // Priority 2: Test saturation (consecutive test-only loops)
  if (analysis.isTestOnly && consecutiveTestOnly >= testThreshold) {
    return 'test_saturation';
  }

  // Priority 3: EXIT_SIGNAL + completion indicators (dual-condition gate)
  // Following ralph-claude-code: exit when both EXIT_SIGNAL: true AND completion_indicators >= 2
  if (analysis.exitSignal === true) {
    if (analysis.completionIndicators >= 2) {
      return 'project_complete';
    }
    // EXIT_SIGNAL true but not enough indicators - still exit
    return 'exit_signal';
  }

  // If EXIT_SIGNAL is explicitly false, continue even with completion indicators
  // This respects Claude's explicit intent

  return null;
}

/**
 * Compare current errors with previous errors to detect stuck state.
 * Returns true if ALL current errors appear in previous error list.
 */
export function areErrorsRepeating(
  currentErrors: string[],
  previousErrors: string[]
): boolean {
  if (currentErrors.length === 0) {
    return false;
  }

  // All current errors must be in previous errors
  return currentErrors.every(err =>
    previousErrors.some(prev => prev.includes(err) || err.includes(prev))
  );
}
