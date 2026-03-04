"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenClawAgentDispatcher = exports.MockAgentDispatcher = void 0;
exports.getAgentDispatcher = getAgentDispatcher;
exports.setAgentDispatcher = setAgentDispatcher;
const logger_1 = require("./logger");
// Mock dispatcher for Phase 1 testing
class MockAgentDispatcher {
    async dispatch(stage, context, traceId, model) {
        const start = Date.now();
        logger_1.orchestratorLogger.info(`[Mock] Dispatching ${stage.agentId} (model:${model || 'default'}) trace:${traceId}`);
        await new Promise(r => setTimeout(r, 50)); // Simulate work
        return {
            stageId: stage.id,
            agentId: stage.agentId,
            status: 'completed',
            output: { message: 'Mock result', model, traceId },
            durationMs: Date.now() - start,
        };
    }
}
exports.MockAgentDispatcher = MockAgentDispatcher;
// Real dispatcher using OpenClaw sessions_spawn (HTTP API)
class OpenClawAgentDispatcher {
    client; // Sẽ import OpenClawClient khi cần
    constructor() {
        // Dynamic import để tránh circular
        this.client = null;
    }
    getClient() {
        if (!this.client) {
            const { getOpenClawClient } = require('./openclaw_client');
            this.client = getOpenClawClient();
        }
        return this.client;
    }
    async dispatch(stage, context, traceId, model) {
        const start = Date.now();
        const agentId = stage.agentId;
        const task = this.buildPrompt(stage, context, traceId);
        logger_1.orchestratorLogger.info(`Dispatching to agent ${agentId} via OpenClaw API (model:${model || 'default'})`);
        try {
            const client = this.getClient();
            const spawnResult = await client.spawnSession({
                agentId,
                task,
                mode: 'run',
                timeoutSeconds: stage.timeout_seconds,
                model,
            });
            if (!spawnResult.sessionKey) {
                throw new Error(spawnResult.error?.message || 'Failed to spawn agent session');
            }
            // Wait for completion
            const result = await client.waitForSession(spawnResult.sessionKey, (stage.timeout_seconds || 300) * 1000 + 10000);
            if (result.status !== 'completed') {
                throw new Error(`Agent session ${result.status}: ${result.error?.message || 'Unknown error'}`);
            }
            const duration = Date.now() - start;
            return {
                stageId: stage.id,
                agentId,
                status: 'completed',
                output: result.output || { result: 'OK' },
                durationMs: duration,
            };
        }
        catch (err) {
            const duration = Date.now() - start;
            const isTimeout = err.message?.includes('timeout') || err.code === 'TIMEOUT';
            return {
                stageId: stage.id,
                agentId,
                status: isTimeout ? 'timeout' : 'failed',
                error: {
                    code: isTimeout ? 'TIMEOUT' : 'DISPATCH_FAILED',
                    message: err.message || String(err),
                    retryable: this.isRetryableError(err),
                },
                durationMs: duration,
            };
        }
    }
    buildPrompt(stage, context, traceId) {
        return `[TRACE: ${traceId} | STAGE: ${stage.id} | AGENT: ${stage.agentId}]\n\nTask: ${stage.task}\n\nProject: ${context.inputs.project_path}\n\nExecute and return JSON result.`;
    }
    isRetryableError(err) {
        const msg = (err.message || String(err)).toLowerCase();
        return msg.includes('timeout') || msg.includes('rate limit') || msg.includes('unavailable') || msg.includes('network');
    }
}
exports.OpenClawAgentDispatcher = OpenClawAgentDispatcher;
// Factory
let dispatcherInstance = null;
function getAgentDispatcher(useReal = false) {
    if (!dispatcherInstance) {
        dispatcherInstance = useReal ? new OpenClawAgentDispatcher() : new MockAgentDispatcher();
    }
    return dispatcherInstance;
}
function setAgentDispatcher(dispatcher) {
    dispatcherInstance = dispatcher;
}
