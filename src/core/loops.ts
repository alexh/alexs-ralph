import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { Loop, LoopStatus, LoopEvent, Issue, AgentType } from './types.js';
import { getAdapter } from '../adapters/index.js';
import { appendLog } from './logs.js';
import { buildPromptFromIssue } from './issues.js';
import { COMPLETION_PROMISE } from '../config.js';
import {
  loadState,
  saveState,
  updateLoop,
  addLoop,
  generateLoopId,
  ensureLoopDir,
} from './state.js';

// Active child processes
const processes: Map<string, ChildProcess> = new Map();

// Event emitter for loop events
export const loopEvents = new EventEmitter();

// Emit a typed event
function emit(event: LoopEvent): void {
  loopEvents.emit('event', event);
  loopEvents.emit(event.type, event);
}

// Create a new loop from an issue
export function createLoop(
  issue: Issue,
  agent: AgentType,
  skipPermissions: boolean,
  workingDir: string
): Loop {
  const id = generateLoopId();
  ensureLoopDir(id);

  const loop: Loop = {
    id,
    issue,
    agent,
    status: 'queued',
    skipPermissions,
    workingDir,
  };

  // Save to state
  let state = loadState();
  state = addLoop(state, loop);
  saveState(state);

  appendLog(id, { type: 'system', content: `Loop created for issue: ${issue.title}` });

  return loop;
}

// Start a loop
export function startLoop(loopId: string): void {
  let state = loadState();
  const loop = state.loops.find(l => l.id === loopId);

  if (!loop) {
    throw new Error(`Loop not found: ${loopId}`);
  }

  if (loop.status === 'running') {
    throw new Error(`Loop already running: ${loopId}`);
  }

  const adapter = getAdapter(loop.agent);
  if (!adapter) {
    throw new Error(`Adapter not found for agent: ${loop.agent}`);
  }

  if (!adapter.isAvailable()) {
    throw new Error(`Agent CLI not available: ${loop.agent}`);
  }

  // Build prompt and command
  const prompt = buildPromptFromIssue(loop.issue);
  const command = adapter.buildCommand(prompt, loop.skipPermissions);

  appendLog(loopId, { type: 'system', content: `Starting ${loop.agent} agent...` });
  appendLog(loopId, { type: 'system', content: `Command: ${command.substring(0, 100)}...` });

  // Spawn child process
  const child = spawn('sh', ['-c', command], {
    cwd: loop.workingDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  processes.set(loopId, child);

  // Update state
  state = updateLoop(state, loopId, {
    status: 'running',
    pid: child.pid,
    startedAt: new Date().toISOString(),
  });
  saveState(state);

  emit({ type: 'started', loopId });

  // Handle stdout
  child.stdout?.on('data', (data: Buffer) => {
    const text = data.toString();
    appendLog(loopId, { type: 'agent', content: text });
    emit({ type: 'output', loopId, data: text });

    // Check for completion tag
    if (text.includes(COMPLETION_PROMISE)) {
      appendLog(loopId, { type: 'system', content: 'Task completion detected!' });
      completeLoop(loopId);
    }
  });

  // Handle stderr
  child.stderr?.on('data', (data: Buffer) => {
    const text = data.toString();
    appendLog(loopId, { type: 'error', content: text });
  });

  // Handle exit
  child.on('exit', (code, signal) => {
    processes.delete(loopId);

    let state = loadState();
    const currentLoop = state.loops.find(l => l.id === loopId);

    // Only update if not already completed/stopped
    if (currentLoop?.status === 'running') {
      if (code === 0) {
        state = updateLoop(state, loopId, {
          status: 'completed',
          endedAt: new Date().toISOString(),
        });
        appendLog(loopId, { type: 'system', content: 'Loop completed successfully' });
        emit({ type: 'completed', loopId });
      } else {
        state = updateLoop(state, loopId, {
          status: 'error',
          error: `Exited with code ${code}, signal ${signal}`,
          endedAt: new Date().toISOString(),
        });
        appendLog(loopId, { type: 'error', content: `Exited with code ${code}` });
        emit({ type: 'error', loopId, error: `Exit code ${code}` });
      }
      saveState(state);
    }
  });

  // Handle errors
  child.on('error', (err) => {
    processes.delete(loopId);
    let state = loadState();
    state = updateLoop(state, loopId, {
      status: 'error',
      error: err.message,
      endedAt: new Date().toISOString(),
    });
    saveState(state);
    appendLog(loopId, { type: 'error', content: `Process error: ${err.message}` });
    emit({ type: 'error', loopId, error: err.message });
  });
}

// Pause a loop (SIGSTOP)
export function pauseLoop(loopId: string): void {
  const child = processes.get(loopId);
  if (!child || !child.pid) {
    throw new Error(`No running process for loop: ${loopId}`);
  }

  process.kill(child.pid, 'SIGSTOP');

  let state = loadState();
  state = updateLoop(state, loopId, { status: 'paused' });
  saveState(state);

  appendLog(loopId, { type: 'system', content: 'Loop paused' });
  emit({ type: 'paused', loopId });
}

// Resume a loop (SIGCONT)
export function resumeLoop(loopId: string): void {
  const child = processes.get(loopId);
  if (!child || !child.pid) {
    throw new Error(`No running process for loop: ${loopId}`);
  }

  process.kill(child.pid, 'SIGCONT');

  let state = loadState();
  state = updateLoop(state, loopId, { status: 'running' });
  saveState(state);

  appendLog(loopId, { type: 'system', content: 'Loop resumed' });
  emit({ type: 'resumed', loopId });
}

// Stop a loop (SIGTERM)
export function stopLoop(loopId: string): void {
  const child = processes.get(loopId);
  if (!child || !child.pid) {
    // Maybe already stopped, just update state
    let state = loadState();
    state = updateLoop(state, loopId, {
      status: 'stopped',
      endedAt: new Date().toISOString(),
    });
    saveState(state);
    return;
  }

  process.kill(child.pid, 'SIGTERM');

  let state = loadState();
  state = updateLoop(state, loopId, {
    status: 'stopped',
    endedAt: new Date().toISOString(),
  });
  saveState(state);

  appendLog(loopId, { type: 'system', content: 'Loop stopped by user' });
  emit({ type: 'stopped', loopId });
}

// Complete a loop
function completeLoop(loopId: string): void {
  const child = processes.get(loopId);
  if (child?.pid) {
    process.kill(child.pid, 'SIGTERM');
  }

  let state = loadState();
  state = updateLoop(state, loopId, {
    status: 'completed',
    endedAt: new Date().toISOString(),
  });
  saveState(state);

  emit({ type: 'completed', loopId });
}

// Send intervention (write to stdin)
export function sendIntervention(loopId: string, message: string): void {
  const child = processes.get(loopId);
  if (!child || !child.stdin) {
    throw new Error(`No running process for loop: ${loopId}`);
  }

  child.stdin.write(message + '\n');
  appendLog(loopId, { type: 'operator', content: message });
}

// Get running process for a loop
export function getProcess(loopId: string): ChildProcess | undefined {
  return processes.get(loopId);
}

// Check if a loop has an active process
export function isLoopActive(loopId: string): boolean {
  return processes.has(loopId);
}

// Kill all running processes (for cleanup)
export function killAll(): void {
  for (const [loopId, child] of processes) {
    if (child.pid) {
      process.kill(child.pid, 'SIGKILL');
    }
    processes.delete(loopId);
  }
}
