"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenClawWsClient = void 0;
exports.getOpenClawClient = getOpenClawClient;
exports.getClientType = getClientType;
exports.resetClient = resetClient;
const fs_1 = require("fs");
const path_1 = require("path");
const logger_1 = require("./logger");
// WebSocket client for OpenClaw Gateway using custom protocol (type: "req")
class OpenClawWsClient {
    ws = null;
    url;
    token;
    agentId; // Dynamic agent ID for handshake
    pendingRequests = new Map();
    isConnected = false;
    reconnectAttempts = 0;
    maxReconnectAttempts = 5;
    lastSentMessage = null;
    _connectPromise;
    constructor(options) {
        const configPath = process.env.OPENCLAW_CONFIG_PATH || (0, path_1.join)(process.cwd(), 'openclaw.json');
        let gatewayUrl = 'ws://127.0.0.1:18789';
        let gatewayToken = '';
        if ((0, fs_1.existsSync)(configPath)) {
            try {
                const config = JSON.parse((0, fs_1.readFileSync)(configPath, 'utf8'));
                const protocol = config.gateway.protocol === 'wss' ? 'wss' : 'ws';
                gatewayUrl = `${protocol}://${config.gateway.host || '127.0.0.1'}:${config.gateway.port || 18789}`;
                gatewayToken = config.gateway.auth.mode === 'token' ? config.gateway.auth.token : '';
            }
            catch (err) {
                console.warn('[OpenClawWsClient] Failed to load config:', err);
            }
        }
        this.url = options?.baseUrl || gatewayUrl;
        this.token = options?.token || gatewayToken || process.env.OPENCLAW_TOKEN || '';
        this.agentId = options?.agentId || process.env.OPENCLAW_AGENT_ID;
    }
    async connect() {
        if (this.isConnected) {
            logger_1.orchestratorLogger.debug('[OpenClawWsClient] Already connected, skipping connect()');
            return;
        }
        // If a connection attempt is already in progress, wait for it
        if (this._connectPromise) {
            return this._connectPromise;
        }
        this._connectPromise = new Promise((resolve, reject) => {
            logger_1.orchestratorLogger.info(`[OpenClawWsClient] Connecting to ${this.url}`);
            const WebSocket = require('ws');
            this.ws = new WebSocket(this.url, {
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });
            this.ws.on('open', async () => {
                logger_1.orchestratorLogger.info(`[OpenClawWsClient] Connected successfully`);
                // Skip announce - try direct tool calls
                this.isConnected = true;
                this.reconnectAttempts = 0;
                this._connectPromise = undefined;
                resolve();
            });
            this.ws.on('message', (data) => {
                try {
                    const msg = JSON.parse(data);
                    logger_1.orchestratorLogger.debug(`[OpenClawWsClient] Received:`, msg);
                    // Handle response: { type: "res", id, ok?, payload?, error? }
                    if (msg.type === 'res' && msg.id && this.pendingRequests.has(msg.id)) {
                        const pending = this.pendingRequests.get(msg.id);
                        clearTimeout(pending.timeout);
                        this.pendingRequests.delete(msg.id);
                        if (!msg.ok || msg.error) {
                            pending.reject(new Error(msg.error?.message || 'WS error'));
                        }
                        else {
                            pending.resolve(msg.payload || msg);
                        }
                        return;
                    }
                    // Handle notifications / events
                    if (msg.type === 'event') {
                        this.handleNotification(msg);
                        return;
                    }
                    // Unknown message type
                    logger_1.orchestratorLogger.debug(`[OpenClawWsClient] Unhandled message type: ${msg.type}`, msg);
                }
                catch (err) {
                    logger_1.orchestratorLogger.error(`[OpenClawWsClient] Failed to parse message:`, err);
                }
            });
            this.ws.on('close', (code, reason) => {
                this.isConnected = false;
                const reasonStr = reason.toString();
                logger_1.orchestratorLogger.warn(`[OpenClawWsClient] Connection closed - code: ${code}, reason: "${reasonStr}"`);
                if (this.lastSentMessage) {
                    logger_1.orchestratorLogger.warn(`[OpenClawWsClient] Last sent message before close:`, this.lastSentMessage);
                }
                // Clear pending requests with a connection closed error
                for (const [id, pending] of this.pendingRequests.entries()) {
                    clearTimeout(pending.timeout);
                    pending.reject(new Error(`WebSocket closed (code=${code}, reason=${reasonStr})`));
                }
                this.pendingRequests.clear();
                this.attemptReconnect();
            });
            this.ws.on('error', (err) => {
                logger_1.orchestratorLogger.error(`[OpenClawWsClient] WebSocket error:`, err);
                reject(err);
            });
        });
    }
    attemptReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            logger_1.orchestratorLogger.error(`[OpenClawWsClient] Max reconnection attempts (${this.maxReconnectAttempts}) reached`);
            return;
        }
        this.reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
        logger_1.orchestratorLogger.info(`[OpenClawWsClient] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
        setTimeout(() => {
            this.connect().catch(err => {
                logger_1.orchestratorLogger.error(`[OpenClawWsClient] Reconnect failed:`, err);
            });
        }, delay);
    }
    handleNotification(msg) {
        logger_1.orchestratorLogger.debug(`[OpenClawWsClient] Notification: ${msg.event || msg.method}`, msg.payload);
    }
    sendRequest(method, params, timeoutMs = 300000) {
        if (!this.isConnected) {
            throw new Error('WebSocket not connected');
        }
        const id = require('uuid').v4();
        // Gateway expects: { type: "req", id, method, params }
        const request = {
            type: 'req',
            id,
            method,
            params
        };
        this.lastSentMessage = request;
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error(`Request timeout after ${timeoutMs}ms`));
            }, timeoutMs);
            this.pendingRequests.set(id, { resolve, reject, timeout });
            try {
                this.ws.send(JSON.stringify(request));
                logger_1.orchestratorLogger.debug(`[OpenClawWsClient] Sent: ${method}`, params);
            }
            catch (err) {
                clearTimeout(timeout);
                this.pendingRequests.delete(id);
                reject(err);
            }
        });
    }
    async spawnSession(params) {
        try {
            // Use tools.invoke to call sessions_spawn
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
        }
        catch (err) {
            logger_1.orchestratorLogger.error(`[OpenClawWsClient] spawnSession error:`, err);
            return { sessionKey: '', error: err };
        }
    }
    async waitForSession(sessionKey, timeoutMs = 300000) {
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
            }
            catch (e) {
                // Continue polling
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        throw new Error(`Timeout waiting for session ${sessionKey}`);
    }
    disconnect() {
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
exports.OpenClawWsClient = OpenClawWsClient;
// Client factory - singleton with lazy init
let globalClient = null;
let clientType = null;
function getOpenClawClient() {
    if (!globalClient) {
        const configPath = (0, path_1.join)(process.cwd(), 'openclaw.json');
        let gatewayUrl = 'ws://127.0.0.1:18789';
        let agentId;
        if ((0, fs_1.existsSync)(configPath)) {
            try {
                const config = JSON.parse((0, fs_1.readFileSync)(configPath, 'utf8'));
                const protocol = config.gateway.protocol === 'wss' ? 'wss' : 'ws';
                gatewayUrl = `${protocol}://${config.gateway.host || '127.0.0.1'}:${config.gateway.port || 18789}`;
                // Try to get default agent ID from config
                agentId = config.agents?.list?.[0]?.id;
            }
            catch (err) {
                console.warn('[OpenClawClient] Failed to load config:', err);
            }
        }
        gatewayUrl = process.env.OPENCLAW_GATEWAY_URL || gatewayUrl;
        agentId = process.env.OPENCLAW_AGENT_ID || agentId;
        if (gatewayUrl.startsWith('ws://') || gatewayUrl.startsWith('wss://')) {
            globalClient = new OpenClawWsClient({ baseUrl: gatewayUrl, agentId });
            clientType = 'ws';
            logger_1.orchestratorLogger.info(`[OpenClawClient] Using WebSocket client (agentId: ${agentId || 'none'})`);
        }
        else {
            // Fallback to HTTP client if needed
            try {
                const { OpenClawHttpClient } = require('./openclaw_client_http');
                globalClient = new OpenClawHttpClient();
                clientType = 'http';
                logger_1.orchestratorLogger.info(`[OpenClawClient] Using HTTP client`);
            }
            catch {
                throw new Error('No suitable client (WS or HTTP) available');
            }
        }
    }
    return globalClient;
}
function getClientType() {
    return clientType;
}
function resetClient() {
    if (globalClient && typeof globalClient.disconnect === 'function') {
        globalClient.disconnect();
    }
    globalClient = null;
    clientType = null;
}
