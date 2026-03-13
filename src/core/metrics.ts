import { readdirSync, readFileSync, existsSync, mkdirSync, appendFileSync, unlinkSync, statSync, renameSync } from 'fs';
import { join } from 'path';
import { orchestratorLogger } from './logger';
import { getMetricsDir } from './paths';

// Types
export interface MetricEvent {
  timestamp: string;
  type: 'workflow' | 'stage' | 'agent' | 'reliability';
  traceId: string;
  workflowId?: string;
  stageId?: string;
  agentId?: string;
  status: 'started' | 'completed' | 'failed' | 'cancelled' | 'incremented';
  durationMs?: number;
  latencyMs?: number;
  error?: {
    code: string;
    message: string;
    retryable?: boolean;
    fallbackUsed?: string;
  };
  modelUsed?: string;
  attempt?: number;
  reliabilityFlags?: {
    isRetry?: boolean;
    conflictsWaited?: boolean;
    conflictTimeout?: boolean;
    isStuckTimeout?: boolean;
    isCircuitOpen?: boolean;
  };
}

interface Summary {
  scope: 'all-time';
  generatedAt: string;
  workflows: {
    started: number;
    completed: number;
    failed: number;
    successRate: number;
    avgDurationMs: number;
    _durationSum: number; // internal
    _durationCount: number; // internal
  };
  stages: {
    completed: number;
    failed: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
    _latencySum: number;
    _latencyCount: number;
    _latencyBuffer: number[]; // runtime only, not persisted
  };
  agents: {
    [agentId: string]: {
      calls: number;
      failures: number;
      failureRate: number;
      avgLatencyMs: number;
      _latencySum: number;
      _latencyCount: number;
    };
  };
  reliability: {
    dispatcherErrors: number;
    timeouts: number;
    fallbacksUsed: number;
    retries: number;
    conflictsWaited: number;
    conflictTimeouts: number;
    circuitOpenCount: number;
    stuckStageTimeouts: number;
  };
}

function createEmptySummary(): Summary {
  return {
    scope: 'all-time',
    generatedAt: new Date().toISOString(),
    workflows: { started: 0, completed: 0, failed: 0, successRate: 0, avgDurationMs: 0, _durationSum: 0, _durationCount: 0 },
    stages: { completed: 0, failed: 0, avgLatencyMs: 0, p95LatencyMs: 0, _latencySum: 0, _latencyCount: 0, _latencyBuffer: [] },
    agents: {},
    reliability: {
      dispatcherErrors: 0,
      timeouts: 0,
      fallbacksUsed: 0,
      retries: 0,
      conflictsWaited: 0,
      conflictTimeouts: 0,
      circuitOpenCount: 0,
      stuckStageTimeouts: 0,
    },
  };
}

export class Metrics {
  private static instance: Metrics;
  private summary: Summary;
  private metricsDir: string;
  private eventCountSinceFlush = 0;
  private flushAfterNEvents = 100;
  private debounceTimer?: NodeJS.Timeout;
  private debounceMs = 30000;
  private latencyBufferMax = 1000;

  private constructor() {
    this.metricsDir = getMetricsDir();
    this.summary = createEmptySummary();
    this.loadSummaryAndIndexes();
    this.registerShutdownHook();
  }

  static getInstance(): Metrics {
    if (!Metrics.instance) {
      Metrics.instance = new Metrics();
    }
    return Metrics.instance;
  }

  private registerShutdownHook(): void {
    process.on('SIGTERM', () => this.persistSummary());
    process.on('SIGINT', () => this.persistSummary());
  }

  getEventsFilePath(ts?: string): string {
    const date = ts ? new Date(parseInt(ts)) : new Date();
    const dateStr = date.toISOString().split('T')[0];
    return join(this.metricsDir, `events-${dateStr}.jsonl`);
  }

  safeReadSummary(): Summary {
    try {
      const summaryPath = join(this.metricsDir, 'summary.json');
      if (!existsSync(summaryPath)) {
        return createEmptySummary();
      }
      const raw = readFileSync(summaryPath, 'utf8');
      const parsed = JSON.parse(raw) as Summary;
      // Ensure scope
      if (parsed.scope !== 'all-time') {
        parsed.scope = 'all-time';
      }
      // Sanitize: ensure all fields exist
      const empty = createEmptySummary();
      return {
        ...empty,
        ...parsed,
        workflows: { ...empty.workflows, ...parsed.workflows },
        stages: { ...empty.stages, ...parsed.stages, _latencyBuffer: [] }, // buffer not persisted
        agents: { ...empty.agents, ...parsed.agents },
        reliability: { ...empty.reliability, ...parsed.reliability },
      };
    } catch (err) {
      orchestratorLogger.error('Failed to read summary.json', err as Error);
      return createEmptySummary();
    }
  }

  safeListMetricFiles(): string[] {
    try {
      if (!existsSync(this.metricsDir)) return [];
      const files = readdirSync(this.metricsDir);
      return files.filter(f => f.startsWith('events-') && f.endsWith('.jsonl'));
    } catch (err) {
      orchestratorLogger.error('Failed to list metric files', err as Error);
      return [];
    }
  }

  async *readEventsFromFile(filePath: string): AsyncIterable<MetricEvent> {
    try {
      if (!existsSync(filePath)) return;
      const raw = readFileSync(filePath, 'utf8');
      const lines = raw.split('\n').filter(l => l.trim().length > 0);
      for (const line of lines) {
        try {
          const ev = JSON.parse(line) as MetricEvent;
          yield ev;
        } catch (e) {
          // Skip malformed line
          continue;
        }
      }
    } catch (err) {
      // Ignore read errors
    }
  }

  async loadSummaryAndIndexes(): Promise<void> {
    try {
      // Ensure metrics dir exists
      if (!existsSync(this.metricsDir)) {
        mkdirSync(this.metricsDir, { recursive: true });
      }

      // Try to read existing summary
      const existing = this.safeReadSummary();
      this.summary = existing;

      // Check if any event file is newer than summary.generatedAt
      const eventFiles = this.safeListMetricFiles();
      const summaryTime = new Date(this.summary.generatedAt).getTime();
      const hasNewerFile = eventFiles.some(f => {
        const filePath = join(this.metricsDir, f);
        const stat = statSync(filePath);
        return stat.mtimeMs > summaryTime;
      });

      // If summary is empty or newer files exist, rebuild
      if (this.summary.workflows.started === 0 || hasNewerFile) {
        await this.rebuildFromEvents();
      } else {
        // Initialize runtime buffer from summary's latencies? No, start fresh.
        this.summary.stages._latencyBuffer = [];
      }
    } catch (err) {
      orchestratorLogger.error('loadSummaryAndIndexes failed', err);
      this.summary = createEmptySummary();
    }
  }

  private async rebuildFromEvents(): Promise<void> {
    const newSummary = createEmptySummary();
    newSummary.generatedAt = new Date().toISOString();

    const eventFiles = this.safeListMetricFiles();
    for (const file of eventFiles) {
      const filePath = join(this.metricsDir, file);
      for await (const ev of this.readEventsFromFile(filePath)) {
        this.updateInMemory(newSummary, ev);
      }
    }

    this.summary = newSummary;
    await this.persistSummary();
  }

  async emit(event: MetricEvent): Promise<void> {
    // 1. Update in-memory summary incrementally
    this.updateInMemory(this.summary, event);

    // 2. Append to day-partitioned file
    try {
      const filePath = this.getEventsFilePath(event.timestamp);
      if (!existsSync(this.metricsDir)) {
        mkdirSync(this.metricsDir, { recursive: true });
      }
      appendFileSync(filePath, JSON.stringify(event) + '\n', 'utf8');
    } catch (err) {
      orchestratorLogger.error('Failed to write event', err as Error, { context: { eventType: event.type } });
    }

    // 3. Persist summary (debounced + flush on N events)
    this.eventCountSinceFlush++;
    if (this.eventCountSinceFlush >= this.flushAfterNEvents) {
      this.persistSummary();
    } else {
      this.debouncedPersist();
    }
  }

  private updateInMemory(sum: Summary, ev: MetricEvent): void {
    // For reliability-only events (type='reliability', status='incremented')
    if (ev.type === 'reliability' && ev.status === 'incremented' && ev.reliabilityFlags) {
      const flags = ev.reliabilityFlags;
      if (flags.isRetry) sum.reliability.retries++;
      if (flags.conflictsWaited) sum.reliability.conflictsWaited++;
      if (flags.conflictTimeout) sum.reliability.conflictTimeouts++;
      if (flags.isStuckTimeout) sum.reliability.stuckStageTimeouts++;
      return;
    }

    // For workflow events
    if (ev.type === 'workflow') {
      if (ev.status === 'started') {
        sum.workflows.started++;
      } else if (ev.status === 'completed') {
        sum.workflows.completed++;
        if (ev.durationMs != null) {
          sum.workflows._durationSum += ev.durationMs;
          sum.workflows._durationCount++;
          sum.workflows.avgDurationMs = sum.workflows._durationCount > 0 ? Math.round(sum.workflows._durationSum / sum.workflows._durationCount) : 0;
        }
      } else if (ev.status === 'failed') {
        sum.workflows.failed++;
      }
      sum.workflows.successRate = sum.workflows.started > 0 ? (sum.workflows.completed / sum.workflows.started) : 0;
    }

    // For stage events
    if (ev.type === 'stage') {
      if (ev.status === 'completed') {
        sum.stages.completed++;
        const latency = ev.latencyMs ?? ev.durationMs ?? 0;
        sum.stages._latencySum += latency;
        sum.stages._latencyCount++;
        sum.stages.avgLatencyMs = sum.stages._latencyCount > 0 ? Math.round(sum.stages._latencySum / sum.stages._latencyCount) : 0;
        // p95 buffer
        sum.stages._latencyBuffer.push(latency);
        if (sum.stages._latencyBuffer.length > this.latencyBufferMax) {
          sum.stages._latencyBuffer.shift();
        }
        if (sum.stages._latencyBuffer.length > 0) {
          const sorted = [...sum.stages._latencyBuffer].sort((a, b) => a - b);
          const idx = Math.floor(0.95 * sorted.length);
          sum.stages.p95LatencyMs = sorted[idx];
        }
      } else if (ev.status === 'failed') {
        sum.stages.failed++;
      }
    }

    // For agent events
    if (ev.type === 'agent' && ev.agentId) {
      const agent = sum.agents[ev.agentId] || { calls: 0, failures: 0, failureRate: 0, avgLatencyMs: 0, _latencySum: 0, _latencyCount: 0 };
      agent.calls++;
      if (ev.status === 'failed') {
        agent.failures++;
      }
      if (ev.durationMs != null) {
        agent._latencySum += ev.durationMs;
        agent._latencyCount++;
        agent.avgLatencyMs = agent._latencyCount > 0 ? Math.round(agent._latencySum / agent._latencyCount) : 0;
      }
      agent.failureRate = agent.calls > 0 ? (agent.failures / agent.calls) : 0;
      sum.agents[ev.agentId] = agent;
    }

    // Reliability flags (from error or derived)
    if (ev.error) {
      const code = ev.error.code;
      if (code === 'TIMEOUT' || ev.error.message?.toLowerCase().includes('timeout')) {
        sum.reliability.timeouts++;
      }
      if (code === 'DISPATCH_FAILED') {
        sum.reliability.dispatcherErrors++;
      }
      if (ev.error.fallbackUsed) {
        sum.reliability.fallbacksUsed++;
      }
      if (code === 'CIRCUIT_OPEN') {
        sum.reliability.circuitOpenCount++;
      }
    }
  }

  private debouncedPersist(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.persistSummary();
    }, this.debounceMs);
  }

  async persistSummary(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    try {
      const out = {
        ...this.summary,
        generatedAt: new Date().toISOString(),
      };
      // Ensure no internal fields leak
      delete (out as any).stages._latencyBuffer;
      const summaryPath = join(this.metricsDir, 'summary.json');
      const tmpPath = summaryPath + '.tmp';
      if (!existsSync(this.metricsDir)) {
        mkdirSync(this.metricsDir, { recursive: true });
      }
      appendFileSync(tmpPath, JSON.stringify(out, null, 2), 'utf8');
      // Atomic replace
      if (existsSync(summaryPath)) unlinkSync(summaryPath);
      renameSync(tmpPath, summaryPath);
      this.eventCountSinceFlush = 0;
    } catch (err) {
      orchestratorLogger.error('Failed to persist summary', err as Error);
    }
  }
}
