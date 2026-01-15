import { Loop, AcceptanceCriterion } from './types.js';
import { generateResumeSummary } from './logs.js';
import { getGitDiff, getChangedFilesSummary } from './worktree.js';

/**
 * Build a review prompt for cross-agent code review
 */
export function buildReviewPrompt(
  originalLoop: Loop,
  workSummary: string,
  gitDiff: string,
  changedFilesSummary: string
): string {
  const { issue } = originalLoop;

  // Format acceptance criteria
  const criteriaList = issue.acceptanceCriteria
    .map((c, i) => {
      const status = c.completed ? '✓' : '○';
      const completedBy = c.completedBy ? ` (by ${c.completedBy})` : '';
      return `  ${i + 1}. ${status} ${c.text}${completedBy}`;
    })
    .join('\n');

  const prompt = `You are reviewing code changes made by another agent. Your task is to provide a thorough code review.

## Original Issue

**Title:** ${issue.title}
**Issue #${issue.number}** in ${issue.repo}

**Description:**
${issue.body || 'No description provided.'}

## Acceptance Criteria

${criteriaList}

## Work Summary

The implementing agent completed ${originalLoop.iteration || 0} iterations.
Exit reason: ${originalLoop.exitReason || 'unknown'}

${workSummary}

## Files Changed

${changedFilesSummary}

## Git Diff

\`\`\`diff
${gitDiff.slice(0, 50000)}
\`\`\`

---

## Your Review Task

Please review the changes above and provide feedback on:

1. **Correctness**: Does the implementation satisfy the acceptance criteria?
2. **Code Quality**: Is the code clean, readable, and maintainable?
3. **Edge Cases**: Are edge cases and error conditions handled?
4. **Security**: Are there any security concerns?
5. **Performance**: Are there any obvious performance issues?
6. **Testing**: Is there adequate test coverage?

## Output Format

Provide your review in the following format:

### Summary
One paragraph overall assessment.

### Criteria Check
For each acceptance criterion, state whether it was MET or NOT MET with brief explanation.

### Issues Found
List any issues found, categorized by severity:
- 🔴 **Critical**: Must fix before merge
- 🟡 **Warning**: Should fix, but not blocking
- 🔵 **Suggestion**: Optional improvements

### Recommendations
Specific actionable items for the implementing agent.

If all criteria are met and no critical issues are found, mark the review as APPROVED.
If there are issues requiring changes, mark it as CHANGES_REQUESTED.

End your review with:
<review-status>APPROVED</review-status>
or
<review-status>CHANGES_REQUESTED</review-status>
`;

  return prompt;
}

/**
 * Generate full review context for a completed loop
 */
export function generateReviewContext(originalLoop: Loop): {
  workSummary: string;
  gitDiff: string;
  changedFilesSummary: string;
  prompt: string;
} {
  const workingDir = originalLoop.worktreePath || originalLoop.workingDir;

  const workSummary = generateResumeSummary(originalLoop.id, 3000);
  const gitDiff = getGitDiff(workingDir, originalLoop.startCommit);
  const changedFilesSummary = getChangedFilesSummary(workingDir, originalLoop.startCommit);

  const prompt = buildReviewPrompt(originalLoop, workSummary, gitDiff, changedFilesSummary);

  return {
    workSummary,
    gitDiff,
    changedFilesSummary,
    prompt,
  };
}

/**
 * Parse review status from agent output
 */
export function parseReviewStatus(output: string): 'approved' | 'changes_requested' | null {
  const match = output.match(/<review-status>(APPROVED|CHANGES_REQUESTED)<\/review-status>/i);
  if (match) {
    return match[1].toLowerCase() as 'approved' | 'changes_requested';
  }
  return null;
}

/**
 * Extract issues from review output
 */
export function parseReviewIssues(output: string): {
  critical: string[];
  warning: string[];
  suggestion: string[];
} {
  const issues = {
    critical: [] as string[],
    warning: [] as string[],
    suggestion: [] as string[],
  };

  // Simple extraction - look for emoji markers
  const lines = output.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('🔴') || trimmed.toLowerCase().includes('critical:')) {
      issues.critical.push(trimmed.replace(/^🔴\s*\*?\*?Critical\*?\*?:?\s*/i, ''));
    } else if (trimmed.startsWith('🟡') || trimmed.toLowerCase().includes('warning:')) {
      issues.warning.push(trimmed.replace(/^🟡\s*\*?\*?Warning\*?\*?:?\s*/i, ''));
    } else if (trimmed.startsWith('🔵') || trimmed.toLowerCase().includes('suggestion:')) {
      issues.suggestion.push(trimmed.replace(/^🔵\s*\*?\*?Suggestion\*?\*?:?\s*/i, ''));
    }
  }

  return issues;
}
