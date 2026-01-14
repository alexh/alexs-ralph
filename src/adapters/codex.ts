import { execSync } from 'child_process';
import { AgentAdapter, registerAdapter } from './base.js';

const codexAdapter: AgentAdapter = {
  type: 'codex',

  buildCommand(prompt: string, _skipPermissions: boolean): string {
    // Escape the prompt for shell
    const escapedPrompt = prompt.replace(/'/g, "'\\''");

    // Codex CLI uses 'codex' command with prompt
    // Note: codex doesn't have a skip-permissions flag
    return `codex '${escapedPrompt}'`;
  },

  isAvailable(): boolean {
    try {
      execSync('which codex', { encoding: 'utf-8', stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  },
};

// Register on import
registerAdapter(codexAdapter);

export { codexAdapter };
