"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenClawAgentDispatcher = exports.MockAgentDispatcher = void 0;
exports.getAgentDispatcher = getAgentDispatcher;
exports.setAgentDispatcher = setAgentDispatcher;
const logger_1 = require("./logger");
// Mock dispatcher for testing
class MockAgentDispatcher {
    async dispatch(stage, context, traceId, model) {
        const start = Date.now();
        logger_1.orchestratorLogger.info(`[Mock] Dispatching ${stage.agentId} (model:${model || 'default'}) trace:${traceId}`);
        // Determine simulated work duration
        let baseDelay = 40 + Math.random() * 20; // 40-60ms random
        // Artificial delay for conflict testing
        const simulateWorkMs = parseInt(process.env.SIMULATE_WORK_MS || '0', 10);
        const extraDelay = (stage.id === 'scan_a') ? (simulateWorkMs || 500) : 0; // stage A holds lock longer
        const totalDelay = baseDelay + extraDelay;
        await new Promise(r => setTimeout(r, totalDelay));
        const duration = Date.now() - start;
        return {
            stageId: stage.id,
            agentId: stage.agentId,
            status: 'completed',
            output: {
                message: `Mock result (USE_REAL_AGENT=false) - ${stage.agentId} processed: ${stage.task.substring(0, 50)}${stage.task.length > 50 ? '...' : ''}`,
                stageId: stage.id,
                agentId: stage.agentId,
                model: model || 'default',
                traceId,
                timestamp: new Date().toISOString(),
                durationMs: duration,
                simulated: true,
                extraDelay,
            },
            durationMs: duration,
        };
    }
}
exports.MockAgentDispatcher = MockAgentDispatcher;
// Real dispatcher using OpenClaw sessions_spawn (HTTP API)
class OpenClawAgentDispatcher {
    client = null;
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
        const timeoutMs = (stage.timeout_seconds || 300) * 1000;
        logger_1.orchestratorLogger.info(`Dispatching to agent ${agentId} via OpenClaw API (model:${model || 'default'})`);
        try {
            const client = this.getClient();
            // Ensure WebSocket connection is established before spawning
            if (typeof client.connect === 'function') {
                await client.connect();
            }
            const spawnResult = await client.spawnSession({
                agentId,
                task,
                mode: 'run',
                timeoutSeconds: stage.timeout_seconds,
                model,
            });
            if (!spawnResult.sessionKey) {
                const error = spawnResult.error;
                if (error instanceof Error) {
                    logger_1.orchestratorLogger.error(`[orchestrator] session spawn failed`, error, { agentId, context: { model } });
                }
                else {
                    logger_1.orchestratorLogger.error(`[orchestrator] session spawn failed: ${error?.message || 'Unknown error'}`, undefined, { agentId, context: { model, code: error?.code || 'UNKNOWN' } });
                }
                throw new Error(error?.message || 'Failed to spawn agent session');
            }
            logger_1.orchestratorLogger.info(`[orchestrator] session spawned: ${spawnResult.sessionKey}`);
            const waitTimeout = timeoutMs + 10000;
            const result = await client.waitForSession(spawnResult.sessionKey, waitTimeout);
            if (result.status !== 'completed') {
                if (result.error) {
                    logger_1.orchestratorLogger.error(`[orchestrator] session ${spawnResult.sessionKey} ended with status: ${result.status}`, { code: result.status, message: result.error.message || 'Unknown error', retryable: false });
                }
                else {
                    logger_1.orchestratorLogger.error(`[orchestrator] session ${spawnResult.sessionKey} ended with status: ${result.status}`);
                }
                throw new Error(`Agent session ${result.status}: ${result.error?.message || 'Unknown error'}`);
            }
            const duration = Date.now() - start;
            logger_1.orchestratorLogger.info(`[orchestrator] session completed: ${spawnResult.sessionKey} in ${duration}ms`);
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
            if (err instanceof Error) {
                logger_1.orchestratorLogger.error(`[orchestrator] dispatch failed for stage ${stage.id}`, err, { duration_ms: duration });
            }
            else {
                logger_1.orchestratorLogger.error(`[orchestrator] dispatch failed for stage ${stage.id}: ${err.message || String(err)}`, undefined, { duration_ms: duration });
            }
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
// Factory with mode-aware caching
let dispatcherInstance = null;
let lastUseReal = null;
function getAgentDispatcher(useReal) {
    if (dispatcherInstance === null || lastUseReal !== useReal) {
        if (useReal) {
            logger_1.orchestratorLogger.info('Creating OpenClawAgentDispatcher (real mode)');
            dispatcherInstance = new OpenClawAgentDispatcher();
        }
        else {
            logger_1.orchestratorLogger.info('Creating MockAgentDispatcher (mock mode)');
            dispatcherInstance = new MockAgentDispatcher();
        }
        lastUseReal = useReal;
    }
    return dispatcherInstance;
}
function setAgentDispatcher(dispatcher) {
    dispatcherInstance = dispatcher;
    lastUseReal = null;
}
