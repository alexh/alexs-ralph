import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { LogEntry } from './types.js';
import { getLoopDir, ensureLoopDir } from './state.js';

// Get log file path for a loop
export function getLogPath(loopId: string): string {
  return path.join(getLoopDir(loopId), 'log.jsonl');
}

// Append a log entry
export function appendLog(loopId: string, entry: Omit<LogEntry, 'timestamp' | 'loopId'>): void {
  ensureLoopDir(loopId);
  const logPath = getLogPath(loopId);

  const fullEntry: LogEntry = {
    timestamp: new Date().toISOString(),
    loopId,
    ...entry,
  };

  fs.appendFileSync(logPath, JSON.stringify(fullEntry) + '\n');
}

// Read all log entries for a loop
export function readLogs(loopId: string): LogEntry[] {
  const logPath = getLogPath(loopId);

  if (!fs.existsSync(logPath)) {
    return [];
  }

  const content = fs.readFileSync(logPath, 'utf-8');
  const lines = content.trim().split('\n').filter(Boolean);

  return lines.map(line => {
    try {
      return JSON.parse(line) as LogEntry;
    } catch {
      return null;
    }
  }).filter((entry): entry is LogEntry => entry !== null);
}

// Read last N log entries
export function readRecentLogs(loopId: string, count: number): LogEntry[] {
  const logs = readLogs(loopId);
  return logs.slice(-count);
}

// Tail log file and call callback for new entries
export function tailLog(
  loopId: string,
  onEntry: (entry: LogEntry) => void,
  onError?: (error: Error) => void
): () => void {
  const logPath = getLogPath(loopId);
  ensureLoopDir(loopId);

  // Create file if it doesn't exist
  if (!fs.existsSync(logPath)) {
    fs.writeFileSync(logPath, '');
  }

  let position = fs.statSync(logPath).size;
  let watching = true;

  const watcher = fs.watch(logPath, (eventType) => {
    if (!watching || eventType !== 'change') return;

    try {
      const stat = fs.statSync(logPath);
      if (stat.size <= position) return;

      const stream = fs.createReadStream(logPath, {
        start: position,
        encoding: 'utf-8',
      });

      let buffer = '';
      stream.on('data', (chunk) => {
        const chunkStr = chunk.toString();
        buffer += chunkStr;
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim()) {
            try {
              const entry = JSON.parse(line) as LogEntry;
              onEntry(entry);
            } catch {
              // Skip invalid JSON
            }
          }
        }
      });

      stream.on('end', () => {
        position = stat.size;
      });

      stream.on('error', (err) => {
        onError?.(err);
      });
    } catch (err) {
      onError?.(err as Error);
    }
  });

  // Return cleanup function
  return () => {
    watching = false;
    watcher.close();
  };
}

// Format log entry for display
export function formatLogEntry(entry: LogEntry): string {
  const time = new Date(entry.timestamp).toLocaleTimeString();
  const typeColors: Record<string, string> = {
    agent: '#2de2e6',
    operator: '#ff4fd8',
    system: '#666',
    error: '#ff006e',
  };
  const color = typeColors[entry.type] || '#666';
  return `{${color}-fg}[${entry.type}]{/} ${entry.content}`;
}
