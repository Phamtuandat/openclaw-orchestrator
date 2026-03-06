import { orchestratorLogger } from './logger';

export interface AgentDispatchResult {
  stageId: string;
  agentId: string;
  status: 'completed' | 'failed' | 'timeout';
  output?: Record<string, any>;
  error?: { code: string; message: string; retryable: boolean; fallbackUsed?: string };
  durationMs: number;
}

export interface AgentDispatcher {
  dispatch(stage: any, context: any, traceId: string, model?: string): Promise<AgentDispatchResult>;
}

// Mock dispatcher for testing
export class MockAgentDispatcher implements AgentDispatcher {
  async dispatch(stage: any, context: any, traceId: string, model?: string): Promise<AgentDispatchResult> {
    const start = Date.now();
    orchestratorLogger.info(`[Mock] Dispatching ${stage.agentId} (model:${model || 'default'}) trace:${traceId}`);

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

// Real dispatcher using OpenClaw sessions_spawn (HTTP API)
export class OpenClawAgentDispatcher implements AgentDispatcher {
  private client: any = null;

  private getClient() {
    if (!this.client) {
      const { getOpenClawClient } = require('./openclaw_client');
      this.client = getOpenClawClient();
    }
    return this.client;
  }

  async dispatch(stage: any, context: any, traceId: string, model?: string): Promise<AgentDispatchResult> {
    const start = Date.now();
    const agentId = stage.agentId;
    const task = this.buildPrompt(stage, context, traceId);
    const timeoutMs = (stage.timeout_seconds || 300) * 1000;

    orchestratorLogger.info(`Dispatching to agent ${agentId} via OpenClaw API (model:${model || 'default'})`);

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
          orchestratorLogger.error(`[orchestrator] session spawn failed`, error, { agentId, context: { model } });
        } else {
          orchestratorLogger.error(
            `[orchestrator] session spawn failed: ${error?.message || 'Unknown error'}`,
            undefined,
            { agentId, context: { model, code: error?.code || 'UNKNOWN' } }
          );
        }
        throw new Error(error?.message || 'Failed to spawn agent session');
      }

      orchestratorLogger.info(`[orchestrator] session spawned: ${spawnResult.sessionKey}`);

      const waitTimeout = timeoutMs + 10000;
      const result = await client.waitForSession(spawnResult.sessionKey, waitTimeout);

      if (result.status !== 'completed') {
        if (result.error) {
          orchestratorLogger.error(
            `[orchestrator] session ${spawnResult.sessionKey} ended with status: ${result.status}`,
            { code: result.status, message: result.error.message || 'Unknown error', retryable: false }
          );
        } else {
          orchestratorLogger.error(`[orchestrator] session ${spawnResult.sessionKey} ended with status: ${result.status}`);
        }
        throw new Error(`Agent session ${result.status}: ${result.error?.message || 'Unknown error'}`);
      }

      const duration = Date.now() - start;
      orchestratorLogger.info(`[orchestrator] session completed: ${spawnResult.sessionKey} in ${duration}ms`);
      return {
        stageId: stage.id,
        agentId,
        status: 'completed',
        output: result.output || { result: 'OK' },
        durationMs: duration,
      };

    } catch (err: any) {
      const duration = Date.now() - start;
      const isTimeout = err.message?.includes('timeout') || err.code === 'TIMEOUT';
      if (err instanceof Error) {
        orchestratorLogger.error(`[orchestrator] dispatch failed for stage ${stage.id}`, err, { duration_ms: duration });
      } else {
        orchestratorLogger.error(
          `[orchestrator] dispatch failed for stage ${stage.id}: ${err.message || String(err)}`,
          undefined,
          { duration_ms: duration }
        );
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

  private buildPrompt(stage: any, context: any, traceId: string): string {
    return `[TRACE: ${traceId} | STAGE: ${stage.id} | AGENT: ${stage.agentId}]\n\nTask: ${stage.task}\n\nProject: ${context.inputs.project_path}\n\nExecute and return JSON result.`;
  }

  private isRetryableError(err: any): boolean {
    const msg = (err.message || String(err)).toLowerCase();
    return msg.includes('timeout') || msg.includes('rate limit') || msg.includes('unavailable') || msg.includes('network');
  }
}

// Factory with mode-aware caching
let dispatcherInstance: AgentDispatcher | null = null;
let lastUseReal: boolean | null = null;

export function getAgentDispatcher(useReal: boolean): AgentDispatcher {
  if (dispatcherInstance === null || lastUseReal !== useReal) {
    if (useReal) {
      orchestratorLogger.info('Creating OpenClawAgentDispatcher (real mode)');
      dispatcherInstance = new OpenClawAgentDispatcher();
    } else {
      orchestratorLogger.info('Creating MockAgentDispatcher (mock mode)');
      dispatcherInstance = new MockAgentDispatcher();
    }
    lastUseReal = useReal;
  }

  return dispatcherInstance;
}

export function setAgentDispatcher(dispatcher: AgentDispatcher): void {
  dispatcherInstance = dispatcher;
  lastUseReal = null;
}
