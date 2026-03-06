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

// Mock dispatcher for Phase 1 testing
export class MockAgentDispatcher implements AgentDispatcher {
  async dispatch(stage: any, context: any, traceId: string, model?: string): Promise<AgentDispatchResult> {
    const start = Date.now();
    orchestratorLogger.info(`[Mock] Dispatching ${stage.agentId} (model:${model || 'default'}) trace:${traceId}`);
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

// Real dispatcher using OpenClaw sessions_spawn (HTTP API)
export class OpenClawAgentDispatcher implements AgentDispatcher {
  private client: any; // Sẽ import OpenClawClient khi cần
  constructor() {
    // Dynamic import để tránh circular
    this.client = null;
  }

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

    orchestratorLogger.info(`Dispatching to agent ${agentId} via OpenClaw API (model:${model || 'default'})`);

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

    } catch (err: any) {
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

  private buildPrompt(stage: any, context: any, traceId: string): string {
    return `[TRACE: ${traceId} | STAGE: ${stage.id} | AGENT: ${stage.agentId}]\n\nTask: ${stage.task}\n\nProject: ${context.inputs.project_path}\n\nExecute and return JSON result.`;
  }

  private isRetryableError(err: any): boolean {
    const msg = (err.message || String(err)).toLowerCase();
    return msg.includes('timeout') || msg.includes('rate limit') || msg.includes('unavailable') || msg.includes('network');
  }
}

// Factory
let dispatcherInstance: AgentDispatcher | null = null;

export function getAgentDispatcher(useReal: boolean = false): AgentDispatcher {
  if (!dispatcherInstance) {
    dispatcherInstance = useReal ? new OpenClawAgentDispatcher() : new MockAgentDispatcher();
  }
  return dispatcherInstance;
}

export function setAgentDispatcher(dispatcher: AgentDispatcher): void {
  dispatcherInstance = dispatcher;
}

// GatewayToolDispatcher for agents running inside a gateway operator session
export class GatewayToolDispatcher implements AgentDispatcher {
  async dispatch(stage: any, context: any, traceId: string, model?: string): Promise<AgentDispatchResult> {
    const start = Date.now();
    const agentId = stage.agentId;
    const task = stage.task;
    const inputs = context.inputs || {};

    orchestratorLogger.info(`[GatewayToolDispatcher] Spawning ${agentId} via sessions_spawn`);

    const tools = (globalThis as any).tools;
    if (!tools) {
      throw new Error('Gateway tools not available. This agent must run inside a gateway operator session with proper scopes.');
    }

    try {
      // Spawn sub-agent
      const spawnResult = await tools.invoke('sessions_spawn', {
        agentId,
        task,
        inputs,
        mode: 'run',
        thread: false,
        timeoutSeconds: stage.timeout_seconds || 300,
        model
      });

      if (spawnResult.error) {
        throw new Error(spawnResult.error.message || 'sessions_spawn failed');
      }

      const sessionKey = spawnResult.sessionKey;
      orchestratorLogger.info(`[GatewayToolDispatcher] Spawned session ${sessionKey} for ${agentId}`);

      // Wait for completion by polling sessions_list
      const timeoutMs = (stage.timeout_seconds || 300) * 1000 + 10000;
      const pollStart = Date.now();

      while (Date.now() - pollStart < timeoutMs) {
        // Use sessions_list to check status
        const listResult = await tools.invoke('sessions_list', { sessionKey });
        const sessions = listResult?.sessions || [];
        const session = sessions.find((s: any) => s.sessionKey === sessionKey || s.key === sessionKey);

        if (session) {
          if (session.status === 'completed' || session.status === 'failed' || session.status === 'cancelled') {
            const duration = Date.now() - start;
            if (session.status !== 'completed') {
              return {
                stageId: stage.id,
                agentId,
                status: 'failed',
                error: {
                  code: 'AGENT_FAILED',
                  message: session.error?.message || `Session ${session.status}`,
                  retryable: false,
                },
                durationMs: duration,
              };
            }

            return {
              stageId: stage.id,
              agentId,
              status: 'completed',
              output: session.output || { result: 'OK' },
              durationMs: duration,
            };
          }
        }

        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      throw new Error(`Timeout waiting for session ${sessionKey}`);
    } catch (err: any) {
      const duration = Date.now() - start;
      return {
        stageId: stage.id,
        agentId,
        status: 'failed',
        error: {
          code: 'DISPATCH_FAILED',
          message: err.message || String(err),
          retryable: false,
        },
        durationMs: duration,
      };
    }
  }

  async getSession(sessionKey: string): Promise<any> {
    const tools = (globalThis as any).tools;
    if (!tools) throw new Error('tools not available');
    const result = await tools.invoke('sessions_list', { sessionKey });
    const sessions = result?.sessions || [];
    return sessions.find((s: any) => s.sessionKey === sessionKey || s.key === sessionKey) || null;
  }
}
