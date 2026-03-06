import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { orchestratorLogger } from './logger';

// WebSocket client for OpenClaw Gateway
export class OpenClawWsClient {
  private ws: any = null;
  private url: string;
  private token: string;
  private agentId?: string;
  private pendingRequests: Map<string, { resolve: any; reject: any; timeout: NodeJS.Timeout }> = new Map();
  private isConnected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private lastSentMessage: any = null;
  private _connectPromise?: Promise<void>;

  constructor(options?: { baseUrl?: string; token?: string; agentId?: string }) {
    const configPath = process.env.OPENCLAW_CONFIG_PATH || join(process.cwd(), 'openclaw.json');
    let gatewayUrl = 'ws://127.0.0.1:18789';
    let gatewayToken = '';

    if (existsSync(configPath)) {
      try {
        const config = JSON.parse(readFileSync(configPath, 'utf8'));
        const protocol = config.gateway.protocol === 'wss' ? 'wss' : 'ws';
        gatewayUrl = `${protocol}://${config.gateway.host || '127.0.0.1'}:${config.gateway.port || 18789}`;
        gatewayToken = config.gateway.auth.mode === 'token' ? config.gateway.auth.token : '';
      } catch (err) {
        console.warn('[OpenClawWsClient] Failed to load config:', err);
      }
    }

    this.url = options?.baseUrl || gatewayUrl;
    this.token = options?.token || gatewayToken || process.env.OPENCLAW_TOKEN || '';
    this.agentId = options?.agentId || process.env.OPENCLAW_AGENT_ID;
  }

  async connect(): Promise<void> {
    if (this.isConnected) {
      orchestratorLogger.debug('[OpenClawWsClient] Already connected, skipping connect()');
      return;
    }

    if (this._connectPromise) {
      return this._connectPromise;
    }

    this._connectPromise = new Promise((resolve, reject) => {
      orchestratorLogger.info(`[OpenClawWsClient] Connecting to ${this.url}`);
      const WebSocket = require('ws');
      
      this.ws = new WebSocket(this.url, {
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      });

      this.ws.on('open', () => {
        orchestratorLogger.info(`[OpenClawWsClient] Connected`);
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this._connectPromise = undefined;
        resolve();
      });

      this.ws.on('message', (data: any) => {
        try {
          const msg = JSON.parse(data);
          orchestratorLogger.debug(`[OpenClawWsClient] Received:`, msg);
          
          // Handle response: { type: "res", id, ok?, payload?, error? }
          if (msg.type === 'res' && msg.id && this.pendingRequests.has(msg.id)) {
            const pending = this.pendingRequests.get(msg.id)!;
            clearTimeout(pending.timeout);
            this.pendingRequests.delete(msg.id);
            
            if (!msg.ok || msg.error) {
              pending.reject(new Error(msg.error?.message || 'WS error'));
            } else {
              pending.resolve(msg.payload || msg);
            }
            return;
          }
          
          // Handle notifications / events
          if (msg.type === 'event') {
            this.handleNotification(msg);
            return;
          }
          
          orchestratorLogger.debug(`[OpenClawWsClient] Unhandled message type: ${msg.type}`, msg);
        } catch (err) {
          orchestratorLogger.error(`[OpenClawWsClient] Failed to parse message:`, err);
        }
      });

      this.ws.on('close', (code: number, reason: Buffer) => {
        this.isConnected = false;
        const reasonStr = reason.toString();
        orchestratorLogger.warn(`[OpenClawWsClient] Connection closed - code: ${code}, reason: "${reasonStr}"`);
        if (this.lastSentMessage) {
          orchestratorLogger.warn(`[OpenClawWsClient] Last sent message:`, this.lastSentMessage);
        }
        for (const [id, pending] of this.pendingRequests.entries()) {
          clearTimeout(pending.timeout);
          pending.reject(new Error(`WebSocket closed (code=${code}, reason=${reasonStr})`));
        }
        this.pendingRequests.clear();
        this.attemptReconnect();
      });

      this.ws.on('error', (err: any) => {
        orchestratorLogger.error(`[OpenClawWsClient] WebSocket error:`, err);
        reject(err);
      });
    });
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      orchestratorLogger.error(`[OpenClawWsClient] Max reconnection attempts (${this.maxReconnectAttempts}) reached`);
      return;
    }
    
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    orchestratorLogger.info(`[OpenClawWsClient] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    
    setTimeout(() => {
      this.connect().catch(err => {
        orchestratorLogger.error(`[OpenClawWsClient] Reconnect failed:`, err);
      });
    }, delay);
  }

  private handleNotification(msg: any): void {
    orchestratorLogger.debug(`[OpenClawWsClient] Notification: ${msg.event || msg.method}`, msg.payload);
  }

  async sendRequest(method: string, params: any, timeoutMs: number = 30000): Promise<any> {
    if (!this.isConnected) {
      orchestratorLogger.warn(`[OpenClawWsClient] Not connected, connecting first...`);
      await this.connect();
    }

    const id = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const payload = {
      jsonrpc: '2.0',
      id,
      method,
      params
    };

    const timeoutPromise = new Promise((_, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Request timeout after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    const responsePromise = new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject, timeout: timer });
      
      orchestratorLogger.debug(`[OpenClawWsClient] Sending: ${method}`, params);
      this.lastSentMessage = payload;
      this.ws.send(JSON.stringify(payload), (err: any) => {
        if (err) {
          this.pendingRequests.delete(id);
          reject(err);
        }
      });
    });

    try {
      const result = await Promise.race([responsePromise, timeoutPromise]);
      return result;
    } finally {
      this.pendingRequests.delete(id);
    }
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
    try {
      // Use sessions_spawn via tools.invoke
      const result = await this.sendRequest('tools.invoke', {
        tool: 'sessions_spawn',
        args: {
          agentId: params.agentId,
          task: params.task,
          mode: params.mode || 'run',
          thread: params.thread ?? false,
          timeoutSeconds: params.timeoutSeconds,
          model: params.model,
          inputs: params.inputs || {}
        }
      }, 30000);
      
      return {
        sessionKey: result?.sessionKey,
        result
      };
    } catch (err: any) {
      orchestratorLogger.error(`[OpenClawWsClient] spawnSession error:`, err);
      return { sessionKey: '', error: err };
    }
  }

  async waitForSession(sessionKey: string, timeoutMs = 300000): Promise<any> {
    const start = Date.now();
    
    while (Date.now() - start < timeoutMs) {
      try {
        const result = await this.sendRequest('tools.invoke', {
          tool: 'sessions_list',
          args: { sessionKey }
        }, 10000);
        const sessions = result?.sessions || [];
        const session = sessions.find(s => s.key === sessionKey || s.sessionKey === sessionKey);
        if (session && (session.status === 'completed' || session.status === 'failed' || session.status === 'cancelled')) {
          return session;
        }
      } catch (e) {
        // Continue polling
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    throw new Error(`Timeout waiting for session ${sessionKey}`);
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    for (const [, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Disconnected'));
    }
    this.pendingRequests.clear();
  }
}

// Client factory - singleton with lazy init
let globalClient: any = null;
let clientType: 'ws' | 'http' | null = null;

export function getOpenClawClient(): any {
  if (!globalClient) {
    const configPath = join(process.cwd(), 'openclaw.json');
    let gatewayUrl = 'ws://127.0.0.1:18789';
    let agentId: string | undefined;
    
    if (existsSync(configPath)) {
      try {
        const config = JSON.parse(readFileSync(configPath, 'utf8'));
        const protocol = config.gateway.protocol === 'wss' ? 'wss' : 'ws';
        gatewayUrl = `${protocol}://${config.gateway.host || '127.0.0.1'}:${config.gateway.port || 18789}`;
        agentId = config.agents?.list?.[0]?.id;
      } catch (err) {
        console.warn('[OpenClawClient] Failed to load config:', err);
      }
    }
    
    gatewayUrl = process.env.OPENCLAW_GATEWAY_URL || gatewayUrl;
    agentId = process.env.OPENCLAW_AGENT_ID || agentId;
    
    if (gatewayUrl.startsWith('ws://') || gatewayUrl.startsWith('wss://')) {
      globalClient = new OpenClawWsClient({ baseUrl: gatewayUrl, agentId });
      clientType = 'ws';
      orchestratorLogger.info(`[OpenClawClient] Using WebSocket client (agentId: ${agentId || 'none'})`);
    } else {
      // Fallback to HTTP client if needed
      try {
        const { OpenClawHttpClient } = require('./openclaw_client_http');
        globalClient = new OpenClawHttpClient(gatewayUrl);
        clientType = 'http';
        orchestratorLogger.info(`[OpenClawClient] Using HTTP client`);
      } catch (e) {
        orchestratorLogger.error(`[OpenClawClient] Failed to load HTTP client, falling back to WS`, e);
        globalClient = new OpenClawWsClient({ baseUrl: gatewayUrl, agentId });
        clientType = 'ws';
      }
    }
  }
  
  return globalClient;
}

export function setOpenClawClient(client: any): void {
  globalClient = client;
  clientType = null;
}
