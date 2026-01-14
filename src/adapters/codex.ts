import { execSync } from 'child_process';
import { AgentAdapter, SpawnArgs, registerAdapter } from './base.js';

const codexAdapter: AgentAdapter = {
  type: 'codex',

  buildSpawnArgs(prompt: string, skipPermissions: boolean): SpawnArgs {
    // Build argv array for safe execution (no shell)
    // Use 'codex exec' for non-interactive mode
    const args: string[] = ['exec'];

    if (skipPermissions) {
      args.push('--full-auto');
    }

    // Pass prompt as positional argument
    args.push(prompt);

    return {
      cmd: 'codex',
      args,
    };
  },

  buildContinueArgs(sessionId: string, prompt: string, skipPermissions: boolean): SpawnArgs {
    // NOTE: Codex session resume syntax is uncertain. Possible formats:
    // - codex resume SESSION_ID [prompt]
    // - codex exec resume SESSION_ID [prompt]
    // If this fails, loops.ts will fall back to fresh spawn on next iteration
    // when no sessionId is extracted from failed output.
    //
    // Using 'codex exec resume' based on docs reference.
    // If Codex doesn't support this, it will error and we'll gracefully
    // fall back since extractSessionId will return null.
    const args: string[] = ['exec', 'resume', sessionId];

    if (skipPermissions) {
      args.push('--full-auto');
    }

    // Pass follow-up prompt
    args.push(prompt);

    return {
      cmd: 'codex',
      args,
    };
  },

  extractSessionId(output: string): string | null {
    // Codex outputs session ID in JSON format
    // Look for sessionId or session_id patterns
    const sessionIdMatch = output.match(/"sessionId"\s*:\s*"([^"]+)"/);
    if (sessionIdMatch) {
      return sessionIdMatch[1];
    }

    const altMatch = output.match(/"session_id"\s*:\s*"([^"]+)"/);
    if (altMatch) {
      return altMatch[1];
    }

    // Also check for UUID pattern in "Session: <uuid>" format
    const uuidMatch = output.match(/Session:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    return uuidMatch ? uuidMatch[1] : null;
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
