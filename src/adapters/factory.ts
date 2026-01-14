import { execSync, execFileSync } from 'child_process';
import fs from 'fs';
import { AgentAdapter, SpawnArgs } from './base.js';
import { AdapterConfig, TemplateContext } from './schema.js';
import { renderArgs, renderTemplate } from './template.js';

/**
 * Create an AgentAdapter from a config file definition.
 */
export function createCustomAdapter(config: AdapterConfig): AgentAdapter {
  const adapter: AgentAdapter = {
    type: config.name,
    displayName: config.displayName || config.name,

    buildSpawnArgs(prompt: string, skipPermissions: boolean): SpawnArgs {
      const context: TemplateContext = {
        prompt,
        workingDir: process.cwd(),
        skipPermissions,
      };

      return {
        cmd: config.command,
        args: renderArgs(config.spawn.args, context),
      };
    },

    buildContinueArgs(sessionId: string, prompt: string, skipPermissions: boolean): SpawnArgs {
      const context: TemplateContext = {
        prompt,
        workingDir: process.cwd(),
        skipPermissions,
        sessionId,
      };

      return {
        cmd: config.command,
        args: renderArgs(config.continue.args, context),
      };
    },

    extractSessionId(output: string): string | null {
      for (const pattern of config.sessionExtraction.patterns) {
        const regex = new RegExp(pattern);
        const match = output.match(regex);
        if (match && match[1]) {
          return match[1];
        }
      }
      return null;
    },

    isAvailable(): boolean {
      try {
        const { check, target } = config.availability;

        switch (check) {
          case 'which':
            execFileSync('which', [config.command], { stdio: 'pipe' });
            return true;
          case 'exec':
            execSync(target || `${config.command} --version`, { stdio: 'pipe' });
            return true;
          case 'exists':
            return fs.existsSync(target || config.command);
          default:
            return false;
        }
      } catch {
        return false;
      }
    },
  };

  // Add optional methods if configured
  if (config.followUpPrompt) {
    adapter.buildFollowUpPrompt = (context: string): string => {
      return renderTemplate(config.followUpPrompt!, {
        prompt: context,
        workingDir: '',
        skipPermissions: false,
      });
    };
  }

  if (config.resumePrompt) {
    adapter.buildResumePrompt = (workSummary: string, remainingCriteria: string[]): string => {
      return renderTemplate(config.resumePrompt!, {
        prompt: '',
        workingDir: '',
        skipPermissions: false,
        workSummary,
        remainingCriteria,
      });
    };
  }

  return adapter;
}
