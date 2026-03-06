import { v4 as uuidv4 } from 'uuid';
import { orchestratorLogger } from './logger';
import { mkdirSync, appendFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getLogsDir } from './paths';

export type WorkflowStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface WorkflowTrace {
  traceId: string;
  workflowId: string;
  status: WorkflowStatus;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  stages: StageTrace[];
  errors: ErrorTrace[];
  context?: Record<string, any>;
}

export interface StageTrace {
  stageId: string;
  agentId: string;
  taskId?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  output?: Record<string, any>;
  error?: ErrorTrace;
}

export interface ErrorTrace {
  code: string;
  message: string;
  stageId?: string;
  taskId?: string;
  agentId?: string;
  retryable: boolean;
  fallbackUsed?: string;
  stack?: string;
}

export class WorkflowTracer {
  private trace: WorkflowTrace | null = null;
  private logger = orchestratorLogger;

  constructor(workflowId: string, context?: Record<string, any>) {
    this.trace = {
      traceId: uuidv4(),
      workflowId,
      status: 'running',
      startedAt: new Date().toISOString(),
      stages: [],
      errors: [],
      context,
    };
    this.logger.workflow(workflowId, `Workflow started`, { traceId: this.trace.traceId, context });
  }

  startStage(stageId: string, agentId: string, taskId?: string): void {
    if (!this.trace) return;
    const stage: StageTrace = { stageId, agentId, taskId, status: 'running', startedAt: new Date().toISOString() };
    this.trace.stages.push(stage);
    this.logger.agent(agentId, `Stage started: ${stageId}`, { traceId: this.trace.traceId, workflowId: this.trace.workflowId, taskId });
  }

  completeStage(stageId: string, output?: Record<string, any>): void {
    if (!this.trace) return;
    const stage = this.trace.stages.find(s => s.stageId === stageId);
    if (!stage) return;
    stage.status = 'completed';
    stage.completedAt = new Date().toISOString();
    if (stage.startedAt) stage.durationMs = new Date(stage.completedAt!).getTime() - new Date(stage.startedAt).getTime();
    if (output) stage.output = output;
    this.logger.agent(stage.agentId, `Stage completed: ${stageId}`, { traceId: this.trace.traceId, workflowId: this.trace.workflowId, taskId: stage.taskId, duration_ms: stage.durationMs });
  }

  failStage(stageId: string, error: ErrorTrace): void {
    if (!this.trace) return;
    const stage = this.trace.stages.find(s => s.stageId === stageId);
    if (stage) {
      stage.status = 'failed';
      stage.error = error;
      if (!stage.completedAt) {
        stage.completedAt = new Date().toISOString();
        if (stage.startedAt) stage.durationMs = new Date(stage.completedAt!).getTime() - new Date(stage.startedAt).getTime();
      }
    }
    this.trace.errors.push(error);
    this.logger.agent(stage?.agentId || 'unknown', `Stage failed: ${stageId} - ${error.message}`, { traceId: this.trace.traceId, workflowId: this.trace.workflowId, taskId: stage?.taskId });
  }

  complete(): WorkflowTrace {
    if (!this.trace) throw new Error('No active trace');
    this.trace.status = 'completed';
    this.trace.completedAt = new Date().toISOString();
    if (this.trace.startedAt) this.trace.durationMs = new Date(this.trace.completedAt!).getTime() - new Date(this.trace.startedAt).getTime();
    this.logger.workflow(this.trace.workflowId, `Workflow completed`, { traceId: this.trace.traceId, duration_ms: this.trace.durationMs });
    const trace = this.trace;
    this.trace = null;
    this.saveToFile();
    return trace;
  }

  fail(error: ErrorTrace): WorkflowTrace {
    if (!this.trace) throw new Error('No active trace');
    this.trace.status = 'failed';
    this.trace.completedAt = new Date().toISOString();
    if (this.trace.startedAt) this.trace.durationMs = new Date(this.trace.completedAt!).getTime() - new Date(this.trace.startedAt).getTime();
    this.trace.errors.push(error);
    this.logger.workflow(this.trace.workflowId, `Workflow failed: ${error.message}`, { traceId: this.trace.traceId });
    const trace = this.trace;
    this.trace = null;
    this.saveToFile();
    return trace;
  }

  cancel(): WorkflowTrace | null {
    if (!this.trace) return null;
    this.trace.status = 'cancelled';
    this.trace.completedAt = new Date().toISOString();
    if (this.trace.startedAt) this.trace.durationMs = new Date(this.trace.completedAt!).getTime() - new Date(this.trace.startedAt).getTime();
    this.logger.workflow(this.trace.workflowId, `Workflow cancelled`, { traceId: this.trace.traceId });
    const trace = this.trace;
    this.trace = null;
    this.saveToFile();
    return trace;
  }

  getTraceId(): string | undefined { return this.trace?.traceId; }
  getWorkflowId(): string | undefined { return this.trace?.workflowId; }
  isActive(): boolean { return this.trace !== null && this.trace.status === 'running'; }

  private saveToFile(): void {
    if (!this.trace) return;
    try {
      const logsDir = join(getLogsDir(), 'traces');
      if (!existsSync(logsDir)) mkdirSync(logsDir, { recursive: true });
      const datePart = new Date().toISOString().split('T')[0];
      const filePath = join(logsDir, `${datePart}.jsonl`);
      appendFileSync(filePath, JSON.stringify(this.trace) + '\n', { encoding: 'utf8' });
    } catch (err) {
      console.error('[WorkflowTracer] Save failed:', err);
    }
  }
}

let activeTracer: WorkflowTracer | null = null;
export function startWorkflowTrace(workflowId: string, context?: Record<string, any>): WorkflowTracer {
  if (activeTracer) activeTracer.cancel();
  activeTracer = new WorkflowTracer(workflowId, context);
  return activeTracer;
}
export function getActiveTrace(): WorkflowTracer | null { return activeTracer; }
export function endWorkflowTrace(): WorkflowTrace | null {
  if (!activeTracer) return null;
  const trace = activeTracer.isActive() ? activeTracer.complete() : activeTracer.cancel()!;
  activeTracer = null;
  return trace;
}
export function failWorkflowTrace(error: { code: string; message: string; retryable?: boolean; stack?: string }): WorkflowTrace | null {
  if (!activeTracer) return null;
  const trace = activeTracer.fail({ code: error.code, message: error.message, retryable: error.retryable ?? false, stack: error.stack });
  activeTracer = null;
  return trace;
}
