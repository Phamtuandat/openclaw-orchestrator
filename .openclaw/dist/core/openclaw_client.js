"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenClawClient = void 0;
exports.getOpenClawClient = getOpenClawClient;
const fs_1 = require("fs");
const path_1 = require("path");
// Simple HTTP client for OpenClaw Gateway
class OpenClawClient {
    baseUrl;
    token;
    constructor(options) {
        // Load from config if not provided
        const configPath = (0, path_1.join)(process.cwd(), 'openclaw.json');
        let gatewayUrl = 'http://127.0.0.1:18789';
        let gatewayToken = '';
        if ((0, fs_1.existsSync)(configPath)) {
            try {
                const config = JSON.parse((0, fs_1.readFileSync)(configPath, 'utf8'));
                gatewayUrl = `http://127.0.0.1:${config.gateway.port}`;
                gatewayToken = config.gateway.auth.mode === 'token' ? config.gateway.auth.token : '';
            }
            catch (err) {
                console.warn('[OpenClawClient] Failed to load config:', err);
            }
        }
        this.baseUrl = options?.baseUrl || gatewayUrl;
        this.token = options?.token || gatewayToken || process.env.OPENCLAW_TOKEN || '';
    }
    async spawnSession(params) {
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
            const data = await response.json();
            return { sessionKey: data.sessionKey || '', result: data };
        }
        catch (err) {
            return { sessionKey: '', error: err };
        }
    }
    async waitForSession(sessionKey, timeoutMs = 300000) {
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
                const data = await response.json();
                if (data.status === 'completed' || data.status === 'failed' || data.status === 'cancelled') {
                    return data;
                }
                // Still running, wait
                await new Promise(r => setTimeout(r, 1000));
            }
            catch (err) {
                throw err;
            }
        }
        throw new Error(`Timeout waiting for session ${sessionKey}`);
    }
}
exports.OpenClawClient = OpenClawClient;
// Global client instance
let globalClient = null;
function getOpenClawClient() {
    if (!globalClient) {
        globalClient = new OpenClawClient();
    }
    return globalClient;
}
