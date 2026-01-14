import { execSync } from 'child_process';
import { AgentAdapter, registerAdapter } from './base.js';

const claudeAdapter: AgentAdapter = {
  type: 'claude',

  buildCommand(prompt: string, skipPermissions: boolean): string {
    // Escape the prompt for shell
    const escapedPrompt = prompt.replace(/'/g, "'\\''");

    const baseCmd = skipPermissions
      ? 'claude --dangerously-skip-permissions'
      : 'claude';

    // Use -p flag to pass prompt, --output-format stream-json for structured output
    return `${baseCmd} -p '${escapedPrompt}' --output-format stream-json`;
  },

  isAvailable(): boolean {
    try {
      execSync('which claude', { encoding: 'utf-8', stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  },
};

// Register on import
registerAdapter(claudeAdapter);

export { claudeAdapter };
