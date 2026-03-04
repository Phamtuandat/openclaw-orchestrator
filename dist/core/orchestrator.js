"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.Orchestrator = void 0;
const fs_1 = require("fs");
const path_1 = require("path");
const workflow_tracer_1 = require("./workflow_tracer");
const logger_1 = require("./logger");
const file_index_builder_1 = require("./file_index_builder");
const agent_dispatcher_1 = require("./agent_dispatcher");
class Orchestrator {
    logger = logger_1.orchestratorLogger;
    workflowsDir = (0, path_1.join)(process.cwd(), '.openclaw', 'workflows');
    loadedWorkflows = new Map();
    fileIntents = new Map();
    inFlightSessions = new Map();
    conflictGraph;
    constructor() {
        this.loadAllWorkflows();
    }
    loadAllWorkflows() {
        try {
            if (!(0, fs_1.existsSync)(this.workflowsDir))
                return;
            const files = (0, fs_1.readdirSync)(this.workflowsDir).filter(f => f.endsWith('.json'));
            for (const file of files) {
                const path = (0, path_1.join)(this.workflowsDir, file);
                try {
                    const content = (0, fs_1.readFileSync)(path, 'utf8');
                    const wf = JSON.parse(content);
                    this.loadedWorkflows.set(wf.id, wf);
                    this.logger.info(`Loaded workflow: ${wf.id} (${wf.stages.length} stages)`);
                }
                catch (err) {
                    this.logger.error(`Failed to load ${file}: ${err instanceof Error ? err.message : String(err)}`);
                }
            }
        }
        catch (err) {
            this.logger.error(`Workflows scan failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    getWorkflow(id) {
        return this.loadedWorkflows.get(id);
    }
    listWorkflows() {
        return Array.from(this.loadedWorkflows.values()).map(w => ({ id: w.id, name: w.name, version: w.version, stages: w.stages.length }));
    }
    async executeWorkflow(workflowId, context) {
        const workflow = this.loadedWorkflows.get(workflowId);
        if (!workflow)
            throw new Error(`Workflow not found: ${workflowId}`);
        this.logger.info(`Executing workflow: ${workflowId}`);
        const tracer = (0, workflow_tracer_1.startWorkflowTrace)(workflowId, context.inputs);
        const traceId = tracer.getTraceId();
        context.traceId = traceId;
        try {
            // Build file index & dependency graph if needed
            if (!context.fileIndex && context.inputs.project_path) {
                this.logger.info('Building file index...');
                context.fileIndex = await (0, file_index_builder_1.getOrBuildFileIndex)(context.inputs.project_path);
            }
            if (!context.dependencyGraph && context.fileIndex) {
                this.logger.info('Building dependency graph...');
                const builder = new (await Promise.resolve().then(() => __importStar(require('./dependency_graph_builder')))).DependencyGraphBuilder(context.fileIndex);
                context.dependencyGraph = await builder.build();
                this.conflictGraph = context.dependencyGraph;
            }
            // Plan execution
            const plan = this.planExecution(workflow);
            const results = [];
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
                completedAt: finalTrace.completedAt,
                durationMs: finalTrace.durationMs,
                stages: aggregated.stages,
                errors: [],
                finalOutput: aggregated,
            };
        }
        catch (err) {
            tracer.fail({ code: 'WORKFLOW_FAILED', message: err instanceof Error ? err.message : String(err), retryable: false });
            throw err;
        }
    }
    planExecution(workflow) {
        const stageMap = new Map(workflow.stages.map(s => [s.id, s]));
        const inDegree = new Map();
        for (const stage of workflow.stages) {
            inDegree.set(stage.id, stage.dependsOn?.length || 0);
        }
        const queue = [];
        for (const [id, deg] of inDegree.entries())
            if (deg === 0)
                queue.push(id);
        const order = [];
        while (queue.length > 0) {
            const cur = queue.shift();
            const stage = stageMap.get(cur);
            order.push({ ...stage, agentId: stage.agentId, task: stage.task });
            for (const other of workflow.stages) {
                if (other.dependsOn?.includes(cur)) {
                    inDegree.set(other.id, (inDegree.get(other.id) || 0) - 1);
                    if (inDegree.get(other.id) === 0)
                        queue.push(other.id);
                }
            }
        }
        return order;
    }
    async waitIfConflicted(stage, fileIndex) {
        const filesTouched = this.collectFileIntents(stage, fileIndex);
        const conflictingStageIds = new Set();
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
                if (!stillConflicting)
                    break;
                await new Promise(r => setTimeout(r, 500));
            }
        }
    }
    collectFileIntents(stage, fileIndex) {
        if (!stage.targets?.file_patterns)
            return [`stage-${stage.id}`];
        const files = [];
        for (const pattern of stage.targets.file_patterns) {
            files.push(`pattern:${pattern}`);
        }
        return files;
    }
    registerFileIntent(stageId, agentId, files) {
        for (const file of files) {
            this.fileIntents.set(file, { stageId, agentId, files: [file] });
        }
    }
    clearFileIntents(stageId) {
        for (const [file, intent] of this.fileIntents.entries()) {
            if (intent.stageId === stageId)
                this.fileIntents.delete(file);
        }
    }
    async executeStage(stage, context, tracer) {
        const start = Date.now();
        let attempt = 0;
        const maxRetries = 2;
        let usedModel = this.getModelForAgent(stage.agentId);
        let fallbackUsed;
        const dispatcher = (0, agent_dispatcher_1.getAgentDispatcher)(process.env.USE_REAL_AGENT === 'true');
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
                    const result = {
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
                }
                else {
                    throw new Error(dispatchResult.error?.message || 'Agent dispatch failed');
                }
            }
            catch (err) {
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
                const result = {
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
    getModelForAgent(agentId) {
        if (agentId === 'orchestrator-main') {
            return 'openrouter/stepfun/step-3.5-flash:free';
        }
        return 'openai-codex/gpt-5.3-codex';
    }
    getFallbackModel(agentId) {
        if (agentId === 'orchestrator-main') {
            return 'openai-codex/gpt-5.3-codex';
        }
        return 'openrouter/deepseek/deepseek-coder-v2-lite-instruct:free';
    }
    isRetryableError(err) {
        if (err instanceof Error) {
            const msg = err.message.toLowerCase();
            return msg.includes('timeout') || msg.includes('rate limit') || msg.includes('unavailable') || msg.includes('network');
        }
        return false;
    }
    isCriticalFailure(result) {
        return result.status === 'failed' && result.error?.code !== 'TIMEOUT';
    }
    isStageStuck(stageId) {
        const session = this.inFlightSessions.get(stageId);
        if (!session)
            return false;
        const now = Date.now();
        const elapsed = now - session.startTime;
        return elapsed > session.timeoutMs;
    }
    removeInFlightSession(stageId) {
        this.inFlightSessions.delete(stageId);
        for (const [file, intent] of this.fileIntents.entries()) {
            if (intent.stageId === stageId)
                this.fileIntents.delete(file);
        }
    }
    async saveArtifact(stageId, traceId, result) {
        try {
            const artifactsDir = (0, path_1.join)(process.cwd(), '.openclaw', 'artifacts', traceId);
            if (!(0, fs_1.existsSync)(artifactsDir)) {
                (0, fs_1.mkdirSync)(artifactsDir, { recursive: true });
            }
            const filePath = (0, path_1.join)(artifactsDir, `${stageId}.json`);
            const content = JSON.stringify(result, null, 2);
            (0, fs_1.appendFileSync)(filePath, content, { encoding: 'utf8' });
            this.logger.info(`Artifact saved: ${stageId} → ${filePath}`);
        }
        catch (err) {
            this.logger.error(`Failed to save artifact for ${stageId}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    aggregateOutputs(results) {
        return {
            stages: results,
            summary: {
                completed: results.filter(r => r.status === 'completed').length,
                failed: results.filter(r => r.status === 'failed' || r.status === 'timeout').length,
                total: results.length,
            },
        };
    }
    static async execute(workflowId, context) {
        const orch = new Orchestrator();
        return orch.executeWorkflow(workflowId, context);
    }
}
exports.Orchestrator = Orchestrator;
