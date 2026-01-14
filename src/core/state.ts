import fs from 'fs';
import path from 'path';
import { AppState, Loop } from './types.js';
import { DATA_DIR, STATE_FILE, LOOPS_DIR } from '../config.js';

// Ensure data directories exist
export function ensureDataDirs(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(LOOPS_DIR)) {
    fs.mkdirSync(LOOPS_DIR, { recursive: true });
  }
}

// Load state from disk
export function loadState(): AppState {
  ensureDataDirs();

  if (!fs.existsSync(STATE_FILE)) {
    return { loops: [] };
  }

  try {
    const data = fs.readFileSync(STATE_FILE, 'utf-8');
    return JSON.parse(data) as AppState;
  } catch (err) {
    console.error('Failed to load state:', err);
    return { loops: [] };
  }
}

// Save state to disk
export function saveState(state: AppState): void {
  ensureDataDirs();

  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error('Failed to save state:', err);
  }
}

// Get loop directory for a specific loop
export function getLoopDir(loopId: string): string {
  return path.join(LOOPS_DIR, loopId);
}

// Ensure loop directory exists
export function ensureLoopDir(loopId: string): string {
  const loopDir = getLoopDir(loopId);
  if (!fs.existsSync(loopDir)) {
    fs.mkdirSync(loopDir, { recursive: true });
  }
  return loopDir;
}

// Add a loop to state
export function addLoop(state: AppState, loop: Loop): AppState {
  return {
    ...state,
    loops: [...state.loops, loop],
  };
}

// Update a loop in state
export function updateLoop(state: AppState, loopId: string, updates: Partial<Loop>): AppState {
  return {
    ...state,
    loops: state.loops.map(loop =>
      loop.id === loopId ? { ...loop, ...updates } : loop
    ),
  };
}

// Get a loop by ID
export function getLoop(state: AppState, loopId: string): Loop | undefined {
  return state.loops.find(loop => loop.id === loopId);
}

// Generate a unique loop ID
export function generateLoopId(): string {
  return `loop_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}
