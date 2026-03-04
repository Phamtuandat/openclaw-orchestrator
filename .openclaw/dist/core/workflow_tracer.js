"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkflowTracer = void 0;
exports.startWorkflowTrace = startWorkflowTrace;
exports.getActiveTrace = getActiveTrace;
exports.endWorkflowTrace = endWorkflowTrace;
exports.failWorkflowTrace = failWorkflowTrace;
const uuid_1 = require("uuid");
const logger_1 = require("./logger");
const fs_1 = require("fs");
const path_1 = require("path");
class WorkflowTracer {
    trace = null;
    logger = logger_1.orchestratorLogger;
    constructor(workflowId, context) {
        this.trace = {
            traceId: (0, uuid_1.v4)(),
            workflowId,
            status: 'running',
            startedAt: new Date().toISOString(),
            stages: [],
            errors: [],
            context,
        };
        this.logger.workflow(workflowId, `Workflow started`, { traceId: this.trace.traceId, context });
    }
    startStage(stageId, agentId, taskId) {
        if (!this.trace)
            return;
        const stage = { stageId, agentId, taskId, status: 'running', startedAt: new Date().toISOString() };
        this.trace.stages.push(stage);
        this.logger.agent(agentId, `Stage started: ${stageId}`, { traceId: this.trace.traceId, workflowId: this.trace.workflowId, taskId });
    }
    completeStage(stageId, output) {
        if (!this.trace)
            return;
        const stage = this.trace.stages.find(s => s.stageId === stageId);
        if (!stage)
            return;
        stage.status = 'completed';
        stage.completedAt = new Date().toISOString();
        if (stage.startedAt)
            stage.durationMs = new Date(stage.completedAt).getTime() - new Date(stage.startedAt).getTime();
        if (output)
            stage.output = output;
        this.logger.agent(stage.agentId, `Stage completed: ${stageId}`, { traceId: this.trace.traceId, workflowId: this.trace.workflowId, taskId: stage.taskId, duration_ms: stage.durationMs });
    }
    failStage(stageId, error) {
        if (!this.trace)
            return;
        const stage = this.trace.stages.find(s => s.stageId === stageId);
        if (stage) {
            stage.status = 'failed';
            stage.error = error;
            if (!stage.completedAt) {
                stage.completedAt = new Date().toISOString();
                if (stage.startedAt)
                    stage.durationMs = new Date(stage.completedAt).getTime() - new Date(stage.startedAt).getTime();
            }
        }
        this.trace.errors.push(error);
        this.logger.agent(stage?.agentId || 'unknown', `Stage failed: ${stageId} - ${error.message}`, { traceId: this.trace.traceId, workflowId: this.trace.workflowId, taskId: stage?.taskId });
    }
    complete() {
        if (!this.trace)
            throw new Error('No active trace');
        this.trace.status = 'completed';
        this.trace.completedAt = new Date().toISOString();
        if (this.trace.startedAt)
            this.trace.durationMs = new Date(this.trace.completedAt).getTime() - new Date(this.trace.startedAt).getTime();
        this.logger.workflow(this.trace.workflowId, `Workflow completed`, { traceId: this.trace.traceId, duration_ms: this.trace.durationMs });
        const trace = this.trace;
        this.trace = null;
        this.saveToFile();
        return trace;
    }
    fail(error) {
        if (!this.trace)
            throw new Error('No active trace');
        this.trace.status = 'failed';
        this.trace.completedAt = new Date().toISOString();
        if (this.trace.startedAt)
            this.trace.durationMs = new Date(this.trace.completedAt).getTime() - new Date(this.trace.startedAt).getTime();
        this.trace.errors.push(error);
        this.logger.workflow(this.trace.workflowId, `Workflow failed: ${error.message}`, { traceId: this.trace.traceId });
        const trace = this.trace;
        this.trace = null;
        this.saveToFile();
        return trace;
    }
    cancel() {
        if (!this.trace)
            return null;
        this.trace.status = 'cancelled';
        this.trace.completedAt = new Date().toISOString();
        if (this.trace.startedAt)
            this.trace.durationMs = new Date(this.trace.completedAt).getTime() - new Date(this.trace.startedAt).getTime();
        this.logger.workflow(this.trace.workflowId, `Workflow cancelled`, { traceId: this.trace.traceId });
        const trace = this.trace;
        this.trace = null;
        this.saveToFile();
        return trace;
    }
    getTraceId() { return this.trace?.traceId; }
    getWorkflowId() { return this.trace?.workflowId; }
    isActive() { return this.trace !== null && this.trace.status === 'running'; }
    saveToFile() {
        if (!this.trace)
            return;
        try {
            const logsDir = (0, path_1.join)(process.cwd(), '.openclaw', 'logs', 'traces');
            if (!(0, fs_1.existsSync)(logsDir))
                (0, fs_1.mkdirSync)(logsDir, { recursive: true });
            const datePart = new Date().toISOString().split('T')[0];
            const filePath = (0, path_1.join)(logsDir, `${datePart}.jsonl`);
            (0, fs_1.appendFileSync)(filePath, JSON.stringify(this.trace) + '\n', { encoding: 'utf8' });
        }
        catch (err) {
            console.error('[WorkflowTracer] Save failed:', err);
        }
    }
}
exports.WorkflowTracer = WorkflowTracer;
let activeTracer = null;
function startWorkflowTrace(workflowId, context) {
    if (activeTracer)
        activeTracer.cancel();
    activeTracer = new WorkflowTracer(workflowId, context);
    return activeTracer;
}
function getActiveTrace() { return activeTracer; }
function endWorkflowTrace() {
    if (!activeTracer)
        return null;
    const trace = activeTracer.isActive() ? activeTracer.complete() : activeTracer.cancel();
    activeTracer = null;
    return trace;
}
function failWorkflowTrace(error) {
    if (!activeTracer)
        return null;
    const trace = activeTracer.fail({ code: error.code, message: error.message, retryable: error.retryable ?? false, stack: error.stack });
    activeTracer = null;
    return trace;
}
