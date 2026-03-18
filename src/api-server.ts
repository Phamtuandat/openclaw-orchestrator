#!/usr/bin/env node

/**
 * Fastify HTTP API Server for OpenClaw Orchestrator
 * 
 * Provides REST API endpoints for workflow execution, listing, and health checks.
 * Supports API key authentication, request logging, and graceful shutdown.
 */

import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { Orchestrator } from './core/orchestrator';
import { getOrBuildFileIndex } from './core/file_index_builder';
import { orchestratorLogger } from './core/logger';
import { Metrics } from './core/metrics';
import { getConfigDir } from './core/paths';

// ============================================
// Types
// ============================================

interface ExecuteWorkflowRequest {
  inputs: Record<string, any>;
  traceId?: string;
}

interface ApiKeyConfig {
  keys: string[];
}

// ============================================
// Configuration
// ============================================

const PORT = parseInt(process.env.OPENCLAW_ORCHESTRATOR_PORT || '3002', 10);
const HOST = process.env.OPENCLAW_ORCHESTRATOR_HOST || '0.0.0.0';
const SSL_CERT = process.env.OPENCLAW_ORCHESTRATOR_SSL_CERT;
const SSL_KEY = process.env.OPENCLAW_ORCHESTRATOR_SSL_KEY;

// ============================================
// API Key Validation
// ============================================

function loadApiKeys(): string[] {
  // Try env var first
  const envKeys = process.env.OPENCLAW_API_KEYS;
  if (envKeys) {
    const keys = envKeys.split(',').map(k => k.trim()).filter(k => k.length > 0);
    if (keys.length > 0) {
      orchestratorLogger.info(`[API] Loaded ${keys.length} API keys from env`);
      return keys;
    }
  }

  // Try config file
  const configPath = join(getConfigDir(), 'api-keys.json');
  if (existsSync(configPath)) {
    try {
      const content = readFileSync(configPath, 'utf8');
      const config = JSON.parse(content) as ApiKeyConfig;
      if (Array.isArray(config.keys) && config.keys.length > 0) {
        orchestratorLogger.info(`[API] Loaded ${config.keys.length} API keys from config file`);
        return config.keys;
      }
    } catch (err) {
      orchestratorLogger.error(`[API] Failed to load API keys from config: ${err}`);
    }
  }

  orchestratorLogger.warn('[API] No API keys configured - authentication disabled');
  return [];
}

// ============================================
// Create API Server
// ============================================

export function createApiServer(orchestrator: Orchestrator): FastifyInstance {
  const server = Fastify({
    logger: false, // Use our own logger
    bodyLimit: 10 * 1024 * 1024, // 10MB
    requestIdHeader: 'x-request-id',
    genReqId: () => `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
  });

  const validApiKeys = loadApiKeys();
  const authEnabled = validApiKeys.length > 0;

  // ============================================
  // Middleware: CORS
  // ============================================
  server.register(cors, {
    origin: true, // Allow all origins (can be restricted later)
    credentials: true,
  });

  // ============================================
  // Middleware: Helmet (Security Headers)
  // ============================================
  server.register(helmet, {
    contentSecurityPolicy: false, // Disable CSP for API
  });

  // ============================================
  // Middleware: Request Logging
  // ============================================
  server.addHook('onRequest', async (request, reply) => {
    request.log = {
      startTime: Date.now(),
      method: request.method,
      url: request.url,
      requestId: request.id,
    } as any;
  });

  server.addHook('onResponse', async (request, reply) => {
    const duration = Date.now() - (request.log as any).startTime;
    orchestratorLogger.info(
      `[API] ${request.method} ${request.url} ${reply.statusCode} ${duration}ms`,
      { context: { requestId: request.id, duration, status: reply.statusCode } }
    );
  });

  // ============================================
  // Middleware: Authentication
  // ============================================
  server.addHook('preHandler', async (request, reply) => {
    // Skip auth for health endpoint
    if (request.url === '/api/health') {
      return;
    }

    // Skip if auth disabled
    if (!authEnabled) {
      return;
    }

    const apiKey = request.headers['x-api-key'] as string;
    if (!apiKey || !validApiKeys.includes(apiKey)) {
      orchestratorLogger.warn(`[API] Unauthorized request: ${request.method} ${request.url}`, {
        context: { requestId: request.id, hasKey: !!apiKey }
      });
      reply.code(401).send({
        success: false,
        error: 'Unauthorized: Invalid or missing API key',
      });
      return;
    }
  });

  // ============================================
  // Routes
  // ============================================

  // GET /api/health - Health check (no auth required)
  server.get('/api/health', async (request: FastifyRequest, reply: FastifyReply) => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  });

  // GET /api/workflows - List all workflows
  server.get('/api/workflows', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const workflows = orchestrator.listWorkflows();
      return {
        success: true,
        workflows,
      };
    } catch (err: any) {
      orchestratorLogger.error('[API] Failed to list workflows', err);
      reply.code(500).send({
        success: false,
        error: err.message || 'Failed to list workflows',
      });
    }
  });

  // GET /api/workflows/:id - Get workflow definition
  server.get<{ Params: { id: string } }>(
    '/api/workflows/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const workflow = orchestrator.getWorkflow(request.params.id);
        if (!workflow) {
          reply.code(404).send({
            success: false,
            error: `Workflow '${request.params.id}' not found`,
          });
          return;
        }
        return {
          success: true,
          workflow,
        };
      } catch (err: any) {
        orchestratorLogger.error(`[API] Failed to get workflow ${request.params.id}`, err);
        reply.code(500).send({
          success: false,
          error: err.message || 'Failed to get workflow',
        });
      }
    }
  );

  // POST /api/workflows/:id/execute - Execute workflow
  server.post<{ Params: { id: string }; Body: ExecuteWorkflowRequest }>(
    '/api/workflows/:id/execute',
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: ExecuteWorkflowRequest }>,
      reply: FastifyReply
    ) => {
      const workflowId = request.params.id;
      const { inputs, traceId } = request.body;

      orchestratorLogger.info(`[API] Execute workflow: ${workflowId}`, {
        context: { requestId: request.id, traceId, inputs }
      });

      try {
        // Validate workflow exists
        const workflow = orchestrator.getWorkflow(workflowId);
        if (!workflow) {
          const available = orchestrator.listWorkflows().map(w => w.id).join(', ');
          reply.code(404).send({
            success: false,
            error: `Workflow '${workflowId}' not found. Available: ${available}`,
          });
          return;
        }

        // Build file index if project_path provided
        let fileIndex;
        if (inputs?.project_path) {
          orchestratorLogger.info(`[API] Building file index for: ${inputs.project_path}`, {
            context: { requestId: request.id }
          });
          fileIndex = await getOrBuildFileIndex(inputs.project_path);
        }

        // Execute workflow
        const result = await orchestrator.executeWorkflow(workflowId, {
          workflowId,
          inputs,
          traceId: traceId || `api-${request.id}`,
          fileIndex,
        });

        // Return result (orchestrator already includes success field)
        return {
          success: result.status === 'completed',
          traceId: result.traceId,
          status: result.status,
          stages: result.stages,
          finalOutput: result.finalOutput,
          errors: result.errors,
          durationMs: result.durationMs,
        };
      } catch (err: any) {
        orchestratorLogger.error(`[API] Workflow execution failed: ${workflowId}`, err instanceof Error ? err : new Error(String(err)), {
          context: { requestId: request.id }
        });
        reply.code(500).send({
          success: false,
          error: err?.message || 'Workflow execution failed',
          traceId: traceId || `api-${request.id}`,
          status: 'failed',
          stages: [],
          errors: [{ code: 'EXECUTION_FAILED', message: err?.message || String(err), retryable: false }],
        });
      }
    }
  );

  // GET /api/metrics/summary - Get metrics summary
  server.get('/api/metrics/summary', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const metrics = Metrics.getInstance();
      const summary = metrics.safeReadSummary();
      return {
        success: true,
        summary,
      };
    } catch (err: any) {
      orchestratorLogger.error('[API] Failed to get metrics summary', err);
      reply.code(500).send({
        success: false,
        error: err.message || 'Failed to get metrics summary',
      });
    }
  });

  // ============================================
  // Error Handler
  // ============================================
  server.setErrorHandler((error, request, reply) => {
    const err = error instanceof Error ? error : new Error(String(error));
    orchestratorLogger.error('[API] Unhandled error', err, { context: { requestId: request.id } });
    reply.code(500).send({
      success: false,
      error: err.message || 'Internal server error',
    });
  });

  return server;
}

// ============================================
// Start API Server (Standalone Mode)
// ============================================

export async function startApiServer(): Promise<FastifyInstance> {
  const orchestrator = new Orchestrator();
  const server = createApiServer(orchestrator);

  // HTTPS support
  const httpsOptions: any = {};
  if (SSL_CERT && SSL_KEY) {
    try {
      httpsOptions.https = {
        cert: readFileSync(SSL_CERT),
        key: readFileSync(SSL_KEY),
      };
      orchestratorLogger.info('[API] HTTPS enabled');
    } catch (err) {
      orchestratorLogger.error('[API] Failed to load SSL certificates, falling back to HTTP', err);
    }
  }

  // Start server
  try {
    await server.listen({ port: PORT, host: HOST, ...httpsOptions });
    const protocol = httpsOptions.https ? 'https' : 'http';
    orchestratorLogger.info(`[API] Orchestrator HTTP API listening on ${protocol}://${HOST}:${PORT}`);
    console.log(`✅ Orchestrator API Server: ${protocol}://${HOST}:${PORT}`);
    console.log(`   Health: ${protocol}://${HOST}:${PORT}/api/health`);
    console.log(`   Workflows: ${protocol}://${HOST}:${PORT}/api/workflows`);
  } catch (err) {
    orchestratorLogger.error('[API] Failed to start server', err);
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    orchestratorLogger.info(`[API] Received ${signal}, shutting down gracefully...`);
    try {
      await server.close();
      orchestratorLogger.info('[API] Server closed');
      process.exit(0);
    } catch (err) {
      orchestratorLogger.error('[API] Error during shutdown', err);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return server;
}

// ============================================
// Standalone Execution
// ============================================

if (require.main === module) {
  startApiServer().catch(err => {
    console.error('Failed to start API server:', err);
    process.exit(1);
  });
}
