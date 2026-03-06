import { readdirSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { promises as fs } from 'fs';
import { startWorkflowTrace } from './workflow_tracer';
import { orchestratorLogger } from './logger';
import { FileIndex, getOrBuildFileIndex } from './file_index_builder';
import { getAgentDispatcher } from './agent_dispatcher';
import { DependencyGraphBuilder } from './dependency_graph_builder';
import * as glob from 'glob';
import { getWorkflowsDir, getArtifactsDir } from './paths';

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
  private workflowsDir = getWorkflowsDir();
  private loadedWorkflows = new Map<string, WorkflowDefinition>();

  private fileIntents = new Map<string, FileIntent>();
  private inFlightSessions = new Map<string, InFlightSession>();
  private conflictGraph?: any;

  constructor() {
    this.loadAllWorkflows();
  }

  private loadAllWorkflows(): void {
    try {
      this.logger.info(`[orchestrator] Loading workflows from: ${this.workflowsDir}`);
      if (!existsSync(this.workflowsDir)) {
        this.logger.warn(`[orchestrator] Workflows directory does not exist: ${this.workflowsDir}`);
        return;
      }
      const files = readdirSync(this.workflowsDir).filter(f => f.endsWith('.json'));
      this.logger.info(`[orchestrator] Found ${files.length} workflow file(s)`);
      for (const file of files) {
        const path = join(this.workflowsDir, file);
        try {
          const content = readFileSync(path, 'utf8');
          const wf = JSON.parse(content) as WorkflowDefinition;
          this.loadedWorkflows.set(wf.id, wf);
          this.logger.info(`[orchestrator] Loaded workflow: ${wf.id} (${wf.stages.length} stages)`);
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

    // Overall deadline based on workflow timeout
    const deadline = Date.now() + workflow.timeout_minutes * 60 * 1000;

    try {
      // Build file index & dependency graph if needed
      if (!context.fileIndex && context.inputs.project_path) {
        this.logger.info(`[trace:${traceId}] Building file index...`);
        context.fileIndex = await getOrBuildFileIndex(context.inputs.project_path);
      }
      if (!context.dependencyGraph && context.fileIndex) {
        this.logger.info(`[trace:${traceId}] Building dependency graph...`);
        const builder = new (await import('./dependency_graph_builder')).DependencyGraphBuilder(context.fileIndex);
        context.dependencyGraph = await builder.build();
        this.conflictGraph = context.dependencyGraph;
      }

      // Plan execution with validation
      const plan = this.planExecution(workflow);
      this.logger.info(`[trace:${traceId}] Execution plan prepared with ${plan.length} stages`);

      // Execute stages sequentially, respecting file conflicts and deadlines
      const results: TaskResult[] = [];

      for (const stage of plan) {
        // Check overall deadline before starting stage
        if (Date.now() > deadline) {
          throw new Error('WORKFLOW_TIMEOUT');
        }

        // Validate stage (defensive)
        if (!stage.agentId) {
          throw new Error(`Stage ${stage.id} missing required agentId`);
        }

        let stageResult: TaskResult | null = null;
        try {
          await this.waitIfConflicted(stage, context.fileIndex, deadline);
          const filesTouched = this.collectFileIntents(stage, context.fileIndex);
          this.registerFileIntent(stage.id, stage.agentId, filesTouched);
          stageResult = await this.executeStage(stage, context, tracer, deadline);
          results.push(stageResult);
        } finally {
          // Guaranteed cleanup: remove in-flight session and file intents
          this.removeInFlightSession(stage.id);
        }

        if (stageResult && stageResult.status === 'failed' && this.isCriticalFailure(stageResult)) {
          this.logger.error(`[trace:${traceId}] Critical stage failed, aborting: ${stage.id}`);
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

  private planExecution(workflow: WorkflowDefinition): Array<{ id: string; agentId: string; task: string; targets?: any; timeout_seconds?: number; parallel?: boolean }> {
    const stageMap = new Map<string, typeof workflow.stages[0]>();
    for (const s of workflow.stages) {
      stageMap.set(s.id, s);
    }

    // Validate dependencies
    for (const stage of workflow.stages) {
      if (stage.dependsOn) {
        for (const dep of stage.dependsOn) {
          if (!stageMap.has(dep)) {
            throw new Error(`Stage ${stage.id} depends on non-existent stage: ${dep}`);
          }
        }
      }
    }

    const inDegree = new Map<string, number>();
    for (const stage of workflow.stages) {
      inDegree.set(stage.id, stage.dependsOn?.length || 0);
    }

    const queue: string[] = [];
    for (const [id, deg] of inDegree.entries()) if (deg === 0) queue.push(id);

    const order: Array<{ id: string; agentId: string; task: string; targets?: any; timeout_seconds?: number; parallel?: boolean }> = [];
    let processed = 0;
    while (queue.length > 0) {
      const cur = queue.shift()!;
      const stage = stageMap.get(cur)!;
      order.push({
        id: stage.id,
        agentId: stage.agentId,
        task: stage.task,
        targets: stage.targets,
        timeout_seconds: stage.timeout_seconds,
        parallel: stage.parallel,
      });
      processed++;

      for (const other of workflow.stages) {
        if (other.dependsOn?.includes(cur)) {
          const newDeg = (inDegree.get(other.id) || 0) - 1;
          inDegree.set(other.id, newDeg);
          if (newDeg === 0) queue.push(other.id);
        }
      }
    }

    if (processed !== workflow.stages.length) {
      const remaining = workflow.stages.filter(s => !order.find(o => o.id === s.id)).map(s => s.id);
      throw new Error(`Cyclic dependency detected involving stages: ${remaining.join(', ')}`);
    }

    return order;
  }

  private async waitIfConflicted(stage: any, fileIndex?: any, deadline: number = Infinity): Promise<void> {
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
      const startWait = Date.now();
      let lastLog = startWait;

      while (Date.now() < deadline) {
        const stillConflicting = Array.from(conflictingStageIds).some(sid => this.inFlightSessions.has(sid));
        if (!stillConflicting) break;

        // Log progress every 5 seconds
        if (Date.now() - lastLog > 5000) {
          this.logger.info(`Stage ${stage.id} still waiting... (elapsed ${Date.now() - startWait}ms)`);
          lastLog = Date.now();
        }

        await new Promise(r => setTimeout(r, 500));
      }

      if (Date.now() >= deadline) {
        throw new Error('CONFLICT_WAIT_TIMEOUT');
      }

      this.logger.info(`Stage ${stage.id} conflict resolved after ${Date.now() - startWait}ms`);
    }
  }

  private collectFileIntents(stage: any, fileIndex?: any): string[] {
    if (!stage.targets?.file_patterns) {
      return [`stage-${stage.id}`];
    }

    if (!fileIndex || !fileIndex.files) {
      // Without file index, we can't resolve patterns to real files
      // Return pattern keys to at least track conflicts by pattern
      return stage.targets.file_patterns.map(p => `pattern:${p}`);
    }

    const allFiles = Object.keys(fileIndex.files);
    const includePatterns = stage.targets.file_patterns;
    const excludePatterns = stage.targets.exclude_patterns || [];

    let matchedFiles = allFiles.filter(filePath => {
      return includePatterns.some(pattern => this.matchesGlob(filePath, pattern));
    });

    if (excludePatterns.length > 0) {
      matchedFiles = matchedFiles.filter(filePath => {
        return !excludePatterns.some(pattern => this.matchesGlob(filePath, pattern));
      });
    }

    return matchedFiles;
  }

  private matchesGlob(filePath: string, pattern: string): boolean {
    // Convert glob pattern to regex (simple implementation)
    const cleanPath = filePath.split('/').filter(Boolean).join('/');
    const cleanPattern = pattern.split('/').filter(Boolean).join('/');

    const escaped = cleanPattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    let regexStr = escaped
      .replace(/\\\*\*/g, '**')
      .replace(/\\\*/g, '[^/]*')
      .replace(/\\\?/g, '[^/]');

    if (regexStr.startsWith('**')) {
      regexStr = '(?:.*/)?' + regexStr.slice(2);
    }
    if (regexStr.endsWith('**')) {
      regexStr = regexStr.slice(0, -2) + '(?:.*/)?';
    }
    regexStr = regexStr.replace(/\*\*/g, '(?:.*/)?');

    regexStr = '^' + regexStr + '$';
    const regex = new RegExp(regexStr);
    return regex.test(cleanPath);
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

  private async executeStage(
    stage: any,
    context: WorkflowContext,
    tracer: any,
    workflowDeadline: number
  ): Promise<TaskResult> {
    const start = Date.now();
    let attempt = 0;
    const maxRetries = 2;
    let usedModel = this.getModelForAgent(stage.agentId);
    let fallbackUsed: string | undefined;
    const dispatcher = getAgentDispatcher(process.env.USE_REAL_AGENT === 'true');

    // Determine stage-specific timeout (per attempt)
    const stageTimeoutMs = (stage.timeout_seconds || 300) * 1000;

    while (attempt < maxRetries) {
      attempt++;
      tracer.startStage(stage.id, stage.agentId, undefined);

      try {
        // Check if stage already marked stuck (from a previous attempt that didn't clean up)
        if (this.isStageStuck(stage.id)) {
          throw new Error('STAGE_TIMEOUT');
        }

        const sessionStart = Date.now();
        this.inFlightSessions.set(stage.id, {
          stageId: stage.id,
          agentId: stage.agentId,
          startTime: sessionStart,
          timeoutMs: stageTimeoutMs,
          heartbeat: Date.now(),
        });

        // Wrap dispatch in a timeout; compute remaining time
        const remainingMs = Math.max(0, this.inFlightSessions.get(stage.id)!.timeoutMs - (Date.now() - sessionStart));
        const dispatchPromise = dispatcher.dispatch(stage, context, context.traceId, usedModel);
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('STAGE_TIMEOUT')), remainingMs)
        );

        const dispatchResult = await Promise.race([dispatchPromise, timeoutPromise]);
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
        const isTimeout = err instanceof Error && (err.message.includes('timeout') || err.message === 'STAGE_TIMEOUT');

        this.logger.error(`Stage ${stage.id} attempt ${attempt} failed: ${err instanceof Error ? err.message : String(err)}`);

        if (attempt < maxRetries && isRetryable) {
          const backoffMs = Math.min(1000 * Math.pow(2, attempt), 10000);
          this.logger.warn(`Retrying ${stage.id} in ${backoffMs}ms`);
          await new Promise(r => setTimeout(r, backoffMs));
          continue;
        }

        // Fallback model (skip if timeout)
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
    // orchestrator-main must never fallback
    if (agentId === 'orchestrator-main') {
      return null;
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
      const artifactsDir = join(getArtifactsDir(), traceId);
      await fs.mkdir(artifactsDir, { recursive: true });
      const filePath = join(artifactsDir, `${stageId}.json`);
      const content = JSON.stringify(result, null, 2);
      await fs.appendFile(filePath, content + '\n', { encoding: 'utf8' });
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