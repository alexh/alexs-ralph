import { Issue, AgentType } from '../core/types.js';

// Adapter interface for different AI agents
export interface AgentAdapter {
  type: AgentType;

  // Build the shell command to run the agent
  buildCommand(prompt: string, skipPermissions: boolean): string;

  // Check if agent CLI is available
  isAvailable(): boolean;
}

// Registry of adapters
const adapters: Map<AgentType, AgentAdapter> = new Map();

export function registerAdapter(adapter: AgentAdapter): void {
  adapters.set(adapter.type, adapter);
}

export function getAdapter(type: AgentType): AgentAdapter | undefined {
  return adapters.get(type);
}

export function getAvailableAdapters(): AgentAdapter[] {
  return Array.from(adapters.values()).filter(a => a.isAvailable());
}
