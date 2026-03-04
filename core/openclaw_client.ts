import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// Simple HTTP client for OpenClaw Gateway
export class OpenClawClient {
  private baseUrl: string;
  private token: string;

  constructor(options?: { baseUrl?: string; token?: string }) {
    // Load from config if not provided
    const configPath = join(process.cwd(), 'openclaw.json');
    let gatewayUrl = 'http://127.0.0.1:18789';
    let gatewayToken = '';

    if (existsSync(configPath)) {
      try {
        const config = JSON.parse(readFileSync(configPath, 'utf8'));
        gatewayUrl = `http://127.0.0.1:${config.gateway.port}`;
        gatewayToken = config.gateway.auth.mode === 'token' ? config.gateway.auth.token : '';
      } catch (err) {
        console.warn('[OpenClawClient] Failed to load config:', err);
      }
    }

    this.baseUrl = options?.baseUrl || gatewayUrl;
    this.token = options?.token || gatewayToken || process.env.OPENCLAW_TOKEN || '';
  }

  async spawnSession(params: {
    agentId: string;
    task: string;
    inputs?: Record<string, any>;
    mode?: 'run' | 'session';
    thread?: boolean;
    timeoutSeconds?: number;
    model?: string;
  }): Promise<{ sessionKey: string; result?: any; error?: any }> {
    const body = {
      agentId: params.agentId,
      task: params.task,
      inputs: params.inputs || {},
      mode: params.mode || 'run',
      thread: params.thread ?? false,
      timeoutSeconds: params.timeoutSeconds,
      model: params.model,
    };

    try {
      const response = await fetch(`${this.baseUrl}/api/v1/sessions/spawn`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const data = await response.json() as any;
      return { sessionKey: data.sessionKey || '', result: data };
    } catch (err) {
      return { sessionKey: '', error: err };
    }
  }

  async waitForSession(sessionKey: string, timeoutMs = 300000): Promise<any> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const response = await fetch(`${this.baseUrl}/api/v1/sessions/${sessionKey}`, {
          headers: {
            'Authorization': `Bearer ${this.token}`,
          },
        });
        if (!response.ok) {
          throw new Error(`Failed to get session: ${response.status}`);
        }
        const data = await response.json() as any;
        if (data.status === 'completed' || data.status === 'failed' || data.status === 'cancelled') {
          return data;
        }
        // Still running, wait
        await new Promise(r => setTimeout(r, 1000));
      } catch (err) {
        throw err;
      }
    }
    throw new Error(`Timeout waiting for session ${sessionKey}`);
  }
}

// Global client instance
let globalClient: OpenClawClient | null = null;

export function getOpenClawClient(): OpenClawClient {
  if (!globalClient) {
    globalClient = new OpenClawClient();
  }
  return globalClient;
}
