/**
 * Schema for custom agent adapter configuration files.
 * Supports both YAML and JSON formats.
 */

// Adapter configuration loaded from YAML/JSON
export interface AdapterConfig {
  // Required: unique identifier for this adapter
  name: string;

  // Optional: human-readable display name (defaults to name)
  displayName?: string;

  // Required: CLI command to invoke
  command: string;

  // Required: how to check if the CLI is available
  availability: {
    // Check method: 'which' (check PATH), 'exec' (run command), or 'exists' (file exists)
    check: 'which' | 'exec' | 'exists';
    // For 'exec': command to run (should exit 0 if available)
    // For 'exists': path to check
    // For 'which': uses command field
    target?: string;
  };

  // Required: arguments for initial spawn
  spawn: {
    // Argument template array, supports {{variables}} and {{#conditionals}}
    args: string[];
  };

  // Required: arguments for session continuation
  continue: {
    // Argument template array
    args: string[];
  };

  // Required: how to extract session ID from output
  sessionExtraction: {
    // Regex patterns to try (first match wins)
    patterns: string[];
  };

  // Optional: custom follow-up prompt template
  followUpPrompt?: string;

  // Optional: custom resume prompt template
  resumePrompt?: string;

  // Optional: metadata
  meta?: {
    version?: string;
    author?: string;
    description?: string;
  };
}

// Template context passed to rendering
export interface TemplateContext {
  prompt: string;
  workingDir: string;
  skipPermissions: boolean;
  sessionId?: string;
  workSummary?: string;
  remainingCriteria?: string[];
}
