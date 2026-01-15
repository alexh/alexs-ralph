import { Loop, AcceptanceCriterion } from './types.js';

// =============================================================================
// TYPES
// =============================================================================

export interface MetricsSummary {
  total: number;
  completed: number;
  failed: number;         // error status
  inProgress: number;     // running
  paused: number;
  queued: number;
  stopped: number;
}

export interface AgentMetrics {
  agent: string;
  loopsRun: number;
  completed: number;
  failed: number;
  successRate: number;    // 0-100
  avgDurationMs: number;
  avgIterations: number;
}

export interface DailyTrend {
  date: string;           // YYYY-MM-DD
  completed: number;
  failed: number;
}

export interface FailureReason {
  reason: string;
  count: number;
}

export interface IterationStats {
  avgIterations: number;
  minIterations: number;
  maxIterations: number;
  totalIterations: number;
}

export interface CircuitBreakerStats {
  totalTriggers: number;
  byReason: {
    noProgress: number;
    sameError: number;
    testSaturation: number;
    other: number;
  };
}

export interface CriteriaStats {
  totalCriteria: number;
  agentCompleted: number;
  operatorCompleted: number;
  completionRate: number; // 0-100
}

export interface HourlyActivity {
  hour: number;           // 0-23
  count: number;
}

export interface DashboardMetrics {
  summary: MetricsSummary;
  perAgent: AgentMetrics[];
  dailyTrend: DailyTrend[];
  weeklyTrend: DailyTrend[];
  avgTimeToCompletionMs: number;
  topFailureReasons: FailureReason[];
  iterationStats: IterationStats;
  circuitBreakerStats: CircuitBreakerStats;
  criteriaStats: CriteriaStats;
  hourlyActivity: HourlyActivity[];
  computedAt: string;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

export function getLoopDurationMs(loop: Loop): number | null {
  if (!loop.startedAt || !loop.endedAt) return null;
  const start = new Date(loop.startedAt).getTime();
  const end = new Date(loop.endedAt).getTime();
  return end - start;
}

function getLocalDateKey(timestamp: string): string {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatLocalDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getWeekKey(timestamp: string): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const oneJan = new Date(year, 0, 1);
  const week = Math.ceil(((date.getTime() - oneJan.getTime()) / 86400000 + oneJan.getDay() + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function getHour(timestamp: string): number {
  return new Date(timestamp).getHours();
}

function getLocalWeekKey(date: Date): string {
  const year = date.getFullYear();
  const oneJan = new Date(year, 0, 1);
  const dayOfYear = Math.floor((date.getTime() - oneJan.getTime()) / 86400000) + 1;
  const week = Math.ceil((dayOfYear + oneJan.getDay()) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

// =============================================================================
// CALCULATION FUNCTIONS
// =============================================================================

export function calculateSummary(loops: Loop[]): MetricsSummary {
  return {
    total: loops.length,
    completed: loops.filter(l => l.status === 'completed').length,
    failed: loops.filter(l => l.status === 'error').length,
    inProgress: loops.filter(l => l.status === 'running').length,
    paused: loops.filter(l => l.status === 'paused').length,
    queued: loops.filter(l => l.status === 'queued').length,
    stopped: loops.filter(l => l.status === 'stopped').length,
  };
}

export function calculateAgentMetrics(loops: Loop[]): AgentMetrics[] {
  const byAgent = new Map<string, Loop[]>();

  for (const loop of loops) {
    const existing = byAgent.get(loop.agent) || [];
    existing.push(loop);
    byAgent.set(loop.agent, existing);
  }

  const results: AgentMetrics[] = [];

  for (const [agent, agentLoops] of byAgent) {
    const completed = agentLoops.filter(l => l.status === 'completed').length;
    const failed = agentLoops.filter(l => l.status === 'error').length;
    const finishedLoops = agentLoops.filter(l => l.status === 'completed' || l.status === 'error');

    // Calculate avg duration
    const durations = finishedLoops
      .map(getLoopDurationMs)
      .filter((d): d is number => d !== null);
    const avgDurationMs = durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : 0;

    // Calculate avg iterations
    const iterations = agentLoops
      .filter(l => l.iteration !== undefined)
      .map(l => l.iteration!);
    const avgIterations = iterations.length > 0
      ? iterations.reduce((a, b) => a + b, 0) / iterations.length
      : 0;

    results.push({
      agent,
      loopsRun: agentLoops.length,
      completed,
      failed,
      successRate: finishedLoops.length > 0 ? (completed / finishedLoops.length) * 100 : 0,
      avgDurationMs,
      avgIterations,
    });
  }

  // Sort by loops run descending
  return results.sort((a, b) => b.loopsRun - a.loopsRun);
}

export function calculateDailyTrend(loops: Loop[], days: number): DailyTrend[] {
  const now = new Date();
  const trends: DailyTrend[] = [];

  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const dateKey = formatLocalDate(date);

    const dayLoops = loops.filter(l =>
      l.endedAt && getLocalDateKey(l.endedAt) === dateKey
    );

    trends.push({
      date: dateKey,
      completed: dayLoops.filter(l => l.status === 'completed').length,
      failed: dayLoops.filter(l => l.status === 'error').length,
    });
  }

  return trends;
}

export function calculateWeeklyTrend(loops: Loop[], weeks: number): DailyTrend[] {
  const now = new Date();
  const trends: DailyTrend[] = [];

  for (let i = weeks - 1; i >= 0; i--) {
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - (i * 7) - weekStart.getDay());
    const weekKey = getLocalWeekKey(weekStart);

    const weekLoops = loops.filter(l =>
      l.endedAt && getLocalWeekKey(new Date(l.endedAt)) === weekKey
    );

    trends.push({
      date: weekKey,
      completed: weekLoops.filter(l => l.status === 'completed').length,
      failed: weekLoops.filter(l => l.status === 'error').length,
    });
  }

  return trends;
}

export function calculateAvgTimeToCompletion(loops: Loop[]): number {
  const completedLoops = loops.filter(l => l.status === 'completed');
  const durations = completedLoops
    .map(getLoopDurationMs)
    .filter((d): d is number => d !== null);

  if (durations.length === 0) return 0;
  return durations.reduce((a, b) => a + b, 0) / durations.length;
}

export function aggregateFailureReasons(loops: Loop[], limit: number): FailureReason[] {
  const reasons = new Map<string, number>();

  for (const loop of loops) {
    if (loop.status === 'error' || loop.exitReason === 'circuit_breaker') {
      const reason = loop.exitReason || 'error';
      reasons.set(reason, (reasons.get(reason) || 0) + 1);
    }
  }

  return Array.from(reasons.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export function calculateIterationStats(loops: Loop[]): IterationStats {
  const iterations = loops
    .filter(l => l.iteration !== undefined && l.iteration > 0)
    .map(l => l.iteration!);

  if (iterations.length === 0) {
    return { avgIterations: 0, minIterations: 0, maxIterations: 0, totalIterations: 0 };
  }

  return {
    avgIterations: iterations.reduce((a, b) => a + b, 0) / iterations.length,
    minIterations: Math.min(...iterations),
    maxIterations: Math.max(...iterations),
    totalIterations: iterations.reduce((a, b) => a + b, 0),
  };
}

export function calculateCircuitBreakerStats(loops: Loop[]): CircuitBreakerStats {
  let noProgress = 0;
  let sameError = 0;
  let testSaturation = 0;
  let other = 0;

  for (const loop of loops) {
    if (loop.exitReason === 'circuit_breaker') {
      // Try to determine reason from error message if available
      const error = loop.error?.toLowerCase() || '';
      if (error.includes('no progress') || error.includes('noprogress')) {
        noProgress++;
      } else if (error.includes('same error') || error.includes('sameerror')) {
        sameError++;
      } else {
        other++;
      }
    } else if (loop.exitReason === 'test_saturation') {
      testSaturation++;
    }
  }

  return {
    totalTriggers: noProgress + sameError + testSaturation + other,
    byReason: { noProgress, sameError, testSaturation, other },
  };
}

export function calculateCriteriaStats(loops: Loop[]): CriteriaStats {
  let totalCriteria = 0;
  let agentCompleted = 0;
  let operatorCompleted = 0;

  for (const loop of loops) {
    const criteria = loop.issue?.acceptanceCriteria || [];
    for (const c of criteria) {
      totalCriteria++;
      if (c.completed) {
        if (c.completedBy === 'agent') {
          agentCompleted++;
        } else if (c.completedBy === 'operator') {
          operatorCompleted++;
        } else {
          // Default to agent if not specified
          agentCompleted++;
        }
      }
    }
  }

  const completedTotal = agentCompleted + operatorCompleted;

  return {
    totalCriteria,
    agentCompleted,
    operatorCompleted,
    completionRate: totalCriteria > 0 ? (completedTotal / totalCriteria) * 100 : 0,
  };
}

export function calculateHourlyActivity(loops: Loop[]): HourlyActivity[] {
  const hours: number[] = new Array(24).fill(0);

  for (const loop of loops) {
    if (loop.startedAt) {
      const hour = getHour(loop.startedAt);
      hours[hour]++;
    }
  }

  return hours.map((count, hour) => ({ hour, count }));
}

// =============================================================================
// MAIN CALCULATION
// =============================================================================

export function calculateMetrics(
  loops: Loop[],
  includeHidden: boolean,
  trendDays: number = 14,
  trendWeeks: number = 8,
  topFailuresLimit: number = 5
): DashboardMetrics {
  // Filter hidden loops if needed
  const filteredLoops = includeHidden ? loops : loops.filter(l => !l.hidden);

  return {
    summary: calculateSummary(filteredLoops),
    perAgent: calculateAgentMetrics(filteredLoops),
    dailyTrend: calculateDailyTrend(filteredLoops, trendDays),
    weeklyTrend: calculateWeeklyTrend(filteredLoops, trendWeeks),
    avgTimeToCompletionMs: calculateAvgTimeToCompletion(filteredLoops),
    topFailureReasons: aggregateFailureReasons(filteredLoops, topFailuresLimit),
    iterationStats: calculateIterationStats(filteredLoops),
    circuitBreakerStats: calculateCircuitBreakerStats(filteredLoops),
    criteriaStats: calculateCriteriaStats(filteredLoops),
    hourlyActivity: calculateHourlyActivity(filteredLoops),
    computedAt: new Date().toISOString(),
  };
}

// =============================================================================
// EXPORT
// =============================================================================

export function exportMetricsToJson(metrics: DashboardMetrics): string {
  return JSON.stringify(metrics, null, 2);
}

// Format duration for display
export function formatDuration(ms: number): string {
  if (ms === 0) return '—';

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}
