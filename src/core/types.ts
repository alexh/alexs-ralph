// Loop statuses
export type LoopStatus = 'queued' | 'running' | 'paused' | 'completed' | 'error' | 'stopped';

// Agent types
export type AgentType = 'claude' | 'codex';

// Acceptance criterion
export interface AcceptanceCriterion {
  text: string;
  completed: boolean;
}

// GitHub issue data
export interface Issue {
  url: string;
  number: number;
  title: string;
  body: string;
  repo: string;           // owner/repo
  acceptanceCriteria: AcceptanceCriterion[];
}

// A single loop instance
export interface Loop {
  id: string;
  issue: Issue;
  agent: AgentType;
  status: LoopStatus;
  skipPermissions: boolean;
  pid?: number;           // child process PID
  startedAt?: string;     // ISO timestamp
  endedAt?: string;       // ISO timestamp
  error?: string;         // error message if status === 'error'
  workingDir: string;     // cwd for the agent
}

// Log entry for JSONL
export interface LogEntry {
  timestamp: string;
  loopId: string;
  type: 'agent' | 'operator' | 'system' | 'error';
  content: string;
}

// App state persisted to disk
export interface AppState {
  loops: Loop[];
  activeLoopId?: string;
}

// Event types for loop manager
export type LoopEvent =
  | { type: 'started'; loopId: string }
  | { type: 'output'; loopId: string; data: string }
  | { type: 'paused'; loopId: string }
  | { type: 'resumed'; loopId: string }
  | { type: 'stopped'; loopId: string }
  | { type: 'completed'; loopId: string }
  | { type: 'error'; loopId: string; error: string };
