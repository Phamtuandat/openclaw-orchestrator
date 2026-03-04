import { readdirSync, readFileSync, existsSync, mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';
import { startWorkflowTrace } from './workflow_tracer';
import { orchestratorLogger } from './logger';
import { FileIndex, getOrBuildFileIndex } from './file_index_builder';
import { getAgentDispatcher } from './agent_dispatcher';
import { DependencyGraphBuilder } from './dependency_graph_builder';

// Types
interface WorkflowDefinition {
  id: string;
  name: string;
  version: string;
  description?: string;
  stages: Array<{
    id: string;
    agentId: string;
    task: string;
    dependsOn?: string[];
    parallel?: boolean;
    targets?: { file_patterns?: string[]; exclude_patterns?: string[] };
    timeout_seconds?: number;
    outputs?: string[];
  }>;
  max_parallel: number;
  timeout_minutes: number;
}

interface WorkflowContext {
  workflowId: string;
  inputs: Record<string, any>;
  fileIndex?: FileIndex;
  dependencyGraph?: any;
  traceId: string;
}

interface TaskResult {
  stageId: string;
  agentId: string;
  status: 'completed' | 'failed' | 'skipped' | 'timeout';
  output?: Record<string, any>;
  error?: { code: string; message: string; retryable: boolean; fallbackUsed?: string };
  durationMs: number;
  attempt?: number;
  modelUsed?: string;
}

interface FileIntent {
  stageId: string;
  agentId: string;
  files: string[];
}

interface InFlightSession {
  stageId: string;
  agentId: string;
  startTime: number;
  timeoutMs: number;
  heartbeat: number;
}

export class Orchestrator {
  private logger = orchestratorLogger;
  private workflowsDir = join(process.cwd(), '.openclaw', 'workflows');
  private loadedWorkflows = new Map<string, WorkflowDefinition>();

  private fileIntents = new Map<string, FileIntent>();
  private inFlightSessions = new Map<string, InFlightSession>();
  private conflictGraph?: any;

  constructor() {
    this.loadAllWorkflows();
  }

  private loadAllWorkflows(): void {
    try {
      if (!existsSync(this.workflowsDir)) return;
      const files = readdirSync(this.workflowsDir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        const path = join(this.workflowsDir, file);
        try {
          const content = readFileSync(path, 'utf8');
          const wf = JSON.parse(content) as WorkflowDefinition;
          this.loadedWorkflows.set(wf.id, wf);
          this.logger.info(`Loaded workflow: ${wf.id} (${wf.stages.length} stages)`);
        } catch (err) {
          this.logger.error(`Failed to load ${file}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } catch (err) {
      this.logger.error(`Workflows scan failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  getWorkflow(id: string): WorkflowDefinition | undefined {
    return this.loadedWorkflows.get(id);
  }

  listWorkflows(): Array<{ id: string; name: string; version: string; stages: number }> {
    return Array.from(this.loadedWorkflows.values()).map(w => ({ id: w.id, name: w.name, version: w.version, stages: w.stages.length }));
  }

  async executeWorkflow(workflowId: string, context: WorkflowContext): Promise<any> {
    const workflow = this.loadedWorkflows.get(workflowId);
    if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);

    this.logger.info(`Executing workflow: ${workflowId}`);
    const tracer = startWorkflowTrace(workflowId, context.inputs);
    const traceId = tracer.getTraceId()!;
    context.traceId = traceId;

    try {
      // Build file index & dependency graph if needed
      if (!context.fileIndex && context.inputs.project_path) {
        this.logger.info('Building file index...');
        context.fileIndex = await getOrBuildFileIndex(context.inputs.project_path);
      }
      if (!context.dependencyGraph && context.fileIndex) {
        this.logger.info('Building dependency graph...');
        const builder = new (await import('./dependency_graph_builder')).DependencyGraphBuilder(context.fileIndex);
        context.dependencyGraph = await builder.build();
        this.conflictGraph = context.dependencyGraph;
      }

      // Plan execution
      const plan = this.planExecution(workflow);
      const results: TaskResult[] = [];

      // Execute stages
      for (const stage of plan) {
        await this.waitIfConflicted(stage, context.fileIndex);
        const filesTouched = this.collectFileIntents(stage, context.fileIndex);
        this.registerFileIntent(stage.id, stage.agentId, filesTouched);
        const result = await this.executeStage(stage, context, tracer);
        results.push(result);
        this.clearFileIntents(stage.id);

        if (result.status === 'failed' && this.isCriticalFailure(result)) {
          this.logger.error(`Critical stage failed, aborting: ${stage.id}`);
          break;
        }
      }

      // Finalize trace
      const finalTrace = tracer.complete();
      const aggregated = this.aggregateOutputs(results);

      return {
        workflowId,
        status: 'completed',
        traceId: finalTrace.traceId,
        startedAt: finalTrace.startedAt,
        completedAt: finalTrace.completedAt!,
        durationMs: finalTrace.durationMs!,
        stages: aggregated.stages,
        errors: [],
        finalOutput: aggregated,
      };

    } catch (err) {
      tracer.fail({ code: 'WORKFLOW_FAILED', message: err instanceof Error ? err.message : String(err), retryable: false });
      throw err;
    }
  }

  private planExecution(workflow: WorkflowDefinition): any[] {
    const stageMap = new Map(workflow.stages.map(s => [s.id, s]));
    const inDegree = new Map<string, number>();
    for (const stage of workflow.stages) {
      inDegree.set(stage.id, stage.dependsOn?.length || 0);
    }
    const queue: string[] = [];
    for (const [id, deg] of inDegree.entries()) if (deg === 0) queue.push(id);

    const order: any[] = [];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      const stage = stageMap.get(cur)!;
      order.push({ ...stage, agentId: stage.agentId, task: stage.task });
      for (const other of workflow.stages) {
        if (other.dependsOn?.includes(cur)) {
          inDegree.set(other.id, (inDegree.get(other.id) || 0) - 1);
          if (inDegree.get(other.id) === 0) queue.push(other.id);
        }
      }
    }
    return order;
  }

  private async waitIfConflicted(stage: any, fileIndex?: any): Promise<void> {
    const filesTouched = this.collectFileIntents(stage, fileIndex);
    const conflictingStageIds = new Set<string>();

    for (const file of filesTouched) {
      const intent = this.fileIntents.get(file);
      if (intent && intent.stageId !== stage.id) {
        conflictingStageIds.add(intent.stageId);
      }
    }

    if (conflictingStageIds.size > 0) {
      this.logger.warn(`Stage ${stage.id} waiting for conflicts with: ${Array.from(conflictingStageIds).join(', ')}`);
      while (true) {
        const stillConflicting = Array.from(conflictingStageIds).some(sid => this.inFlightSessions.has(sid));
        if (!stillConflicting) break;
        await new Promise(r => setTimeout(r, 500));
      }
    }
  }

  private collectFileIntents(stage: any, fileIndex?: any): string[] {
    if (!stage.targets?.file_patterns) return [`stage-${stage.id}`];
    const files: string[] = [];
    for (const pattern of stage.targets.file_patterns) {
      files.push(`pattern:${pattern}`);
    }
    return files;
  }

  private registerFileIntent(stageId: string, agentId: string, files: string[]): void {
    for (const file of files) {
      this.fileIntents.set(file, { stageId, agentId, files: [file] });
    }
  }

  private clearFileIntents(stageId: string): void {
    for (const [file, intent] of this.fileIntents.entries()) {
      if (intent.stageId === stageId) this.fileIntents.delete(file);
    }
  }

  private async executeStage(stage: any, context: WorkflowContext, tracer: any): Promise<TaskResult> {
    const start = Date.now();
    let attempt = 0;
    const maxRetries = 2;
    let usedModel = this.getModelForAgent(stage.agentId);
    let fallbackUsed: string | undefined;
    const dispatcher = getAgentDispatcher(process.env.USE_REAL_AGENT === 'true');

    while (attempt < maxRetries) {
      attempt++;
      tracer.startStage(stage.id, stage.agentId, undefined);

      try {
        if (this.isStageStuck(stage.id)) {
          throw new Error('STAGE_TIMEOUT');
        }

        this.inFlightSessions.set(stage.id, {
          stageId: stage.id,
          agentId: stage.agentId,
          startTime: Date.now(),
          timeoutMs: (stage.timeout_seconds || 300) * 1000,
          heartbeat: Date.now(),
        });

        const dispatchResult = await dispatcher.dispatch(stage, context, context.traceId, usedModel);
        this.removeInFlightSession(stage.id);

        if (dispatchResult.status === 'completed') {
          tracer.completeStage(stage.id, dispatchResult.output);
          const result: TaskResult = {
            stageId: stage.id,
            agentId: stage.agentId,
            status: 'completed',
            output: dispatchResult.output,
            durationMs: dispatchResult.durationMs,
            attempt,
            modelUsed: usedModel,
          };
          await this.saveArtifact(stage.id, context.traceId, result);
          return result;
        } else {
          throw new Error(dispatchResult.error?.message || 'Agent dispatch failed');
        }

      } catch (err: any) {
        const duration = Date.now() - start;
        const isRetryable = this.isRetryableError(err);
        const isTimeout = err instanceof Error && err.message.includes('timeout');

        this.logger.error(`Stage ${stage.id} attempt ${attempt} failed: ${err instanceof Error ? err.message : String(err)}`);

        if (attempt < maxRetries && isRetryable) {
          const backoffMs = Math.min(1000 * Math.pow(2, attempt), 10000);
          this.logger.warn(`Retrying ${stage.id} in ${backoffMs}ms`);
          await new Promise(r => setTimeout(r, backoffMs));
          continue;
        }

        // Fallback model
        if (attempt === maxRetries && !isTimeout) {
          const fallbackModel = this.getFallbackModel(stage.agentId);
          if (fallbackModel && fallbackModel !== usedModel) {
            this.logger.warn(`Fallback model for ${stage.id}: ${usedModel} -> ${fallbackModel}`);
            usedModel = fallbackModel;
            fallbackUsed = fallbackModel;
            attempt = 0;
            continue;
          }
        }

        this.removeInFlightSession(stage.id);
        const errorData = {
          code: isTimeout ? 'TIMEOUT' : 'DISPATCH_FAILED',
          message: err instanceof Error ? err.message : String(err),
          retryable: false,
          fallbackUsed,
        };
        tracer.failStage(stage.id, errorData);

        const result: TaskResult = {
          stageId: stage.id,
          agentId: stage.agentId,
          status: 'failed',
          error: errorData,
          durationMs: duration,
          attempt,
          modelUsed: usedModel,
        };
        await this.saveArtifact(stage.id, context.traceId, result);
        return result;
      }
    }

    return {
      stageId: stage.id,
      agentId: stage.agentId,
      status: 'failed',
      error: { code: 'UNKNOWN', message: 'Unexpected error', retryable: false },
      durationMs: Date.now() - start,
    };
  }

  private getModelForAgent(agentId: string): string {
    if (agentId === 'orchestrator-main') {
      return 'openrouter/stepfun/step-3.5-flash:free';
    }
    return 'openai-codex/gpt-5.3-codex';
  }

  private getFallbackModel(agentId: string): string | undefined {
    if (agentId === 'orchestrator-main') {
      return 'openai-codex/gpt-5.3-codex';
    }
    return 'openrouter/deepseek/deepseek-coder-v2-lite-instruct:free';
  }

  private isRetryableError(err: any): boolean {
    if (err instanceof Error) {
      const msg = err.message.toLowerCase();
      return msg.includes('timeout') || msg.includes('rate limit') || msg.includes('unavailable') || msg.includes('network');
    }
    return false;
  }

  private isCriticalFailure(result: TaskResult): boolean {
    return result.status === 'failed' && result.error?.code !== 'TIMEOUT';
  }

  private isStageStuck(stageId: string): boolean {
    const session = this.inFlightSessions.get(stageId);
    if (!session) return false;
    const now = Date.now();
    const elapsed = now - session.startTime;
    return elapsed > session.timeoutMs;
  }

  private removeInFlightSession(stageId: string): void {
    this.inFlightSessions.delete(stageId);
    for (const [file, intent] of this.fileIntents.entries()) {
      if (intent.stageId === stageId) this.fileIntents.delete(file);
    }
  }

  private async saveArtifact(stageId: string, traceId: string, result: TaskResult): Promise<void> {
    try {
      const artifactsDir = join(process.cwd(), '.openclaw', 'artifacts', traceId);
      if (!existsSync(artifactsDir)) {
        mkdirSync(artifactsDir, { recursive: true });
      }
      const filePath = join(artifactsDir, `${stageId}.json`);
      const content = JSON.stringify(result, null, 2);
      appendFileSync(filePath, content, { encoding: 'utf8' });
      this.logger.info(`Artifact saved: ${stageId} → ${filePath}`);
    } catch (err) {
      this.logger.error(`Failed to save artifact for ${stageId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private aggregateOutputs(results: TaskResult[]): Record<string, any> {
    return {
      stages: results,
      summary: {
        completed: results.filter(r => r.status === 'completed').length,
        failed: results.filter(r => r.status === 'failed' || r.status === 'timeout').length,
        total: results.length,
      },
    };
  }

  static async execute(workflowId: string, context: WorkflowContext): Promise<any> {
    const orch = new Orchestrator();
    return orch.executeWorkflow(workflowId, context);
  }
}
