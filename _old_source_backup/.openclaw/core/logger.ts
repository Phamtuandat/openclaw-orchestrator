import { appendFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

// Simple logger without complex signatures
export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogComponent = "orchestrator" | "agent" | "workflow" | "self_healing" | "tracer";

export interface LogEntry {
  timestamp: string; // ISO 8601
  level: LogLevel;
  component: LogComponent;

  traceId?: string;
  workflowId?: string;
  taskId?: string;
  agentId?: string;

  message: string;
  context?: Record<string, any>;
  duration_ms?: number;

  error?: { code: string; message: string; retryable?: boolean; fallback_used?: string; stack?: string };
}

const LOG_DIR = join(process.cwd(), ".openclaw", "logs");

// Map component -> directory name (avoid agent/agents + workflow/workflows mismatch)
const COMPONENT_DIR: Record<LogComponent, string> = {
  orchestrator: "orchestrator",
  agent: "agents",
  workflow: "workflows",
  self_healing: "self_healing",
  tracer: "traces",
};

function ensureDirs(): void {
  for (const dir of Object.values(COMPONENT_DIR)) {
    const p = join(LOG_DIR, dir);
    if (!existsSync(p)) mkdirSync(p, { recursive: true });
  }
}

function writeLog(entry: LogEntry): void {
  try {
    ensureDirs();
    const date = new Date().toISOString().split("T")[0];
    const dir = COMPONENT_DIR[entry.component] ?? entry.component;
    const file = join(LOG_DIR, dir, `${date}.log`);
    appendFileSync(file, JSON.stringify(entry) + "\n", "utf8");
  } catch {
    // ignore logging errors
  }
}

function normalizeError(
  err?: Error | { code: string; message: string; retryable?: boolean; fallback_used?: string; stack?: string }
): LogEntry["error"] | undefined {
  if (!err) return undefined;
  if (err instanceof Error) {
    return {
      code: err.name && err.name !== "Error" ? err.name : "ERR",
      message: err.message,
      retryable: false,
      stack: err.stack,
    };
  }
  return {
    code: err.code,
    message: err.message,
    retryable: err.retryable ?? false,
    fallback_used: err.fallback_used,
    stack: err.stack,
  };
}

export class OpenClawLogger {
  private component: LogComponent;

  constructor(component: LogComponent) {
    this.component = component;
  }

  debug(message: string, opts?: { context?: Record<string, any>; traceId?: string; workflowId?: string; taskId?: string; agentId?: string }): void {
    this.log("debug", message, opts);
  }

  info(message: string, opts?: { context?: Record<string, any>; traceId?: string; workflowId?: string; taskId?: string; agentId?: string; duration_ms?: number }): void {
    this.log("info", message, opts);
  }

  warn(message: string, opts?: { context?: Record<string, any>; traceId?: string; workflowId?: string; taskId?: string; agentId?: string }): void {
    this.log("warn", message, opts);
  }

  error(
    message: string,
    err?: Error | { code: string; message: string; retryable?: boolean; fallback_used?: string; stack?: string },
    opts?: { context?: Record<string, any>; traceId?: string; workflowId?: string; taskId?: string; agentId?: string; duration_ms?: number }
  ): void {
    this.log("error", message, { ...opts, error: normalizeError(err) });
  }

  workflow(workflowId: string, message: string, opts?: { traceId?: string; taskId?: string; context?: Record<string, any>; duration_ms?: number }): void {
    // IMPORTANT: traceId must be provided by caller (do not fake it with workflowId)
    this.log("info", message, {
      workflowId,
      traceId: opts?.traceId,
      taskId: opts?.taskId,
      context: opts?.context,
      duration_ms: opts?.duration_ms,
    });
  }

  agent(agentId: string, message: string, opts?: { traceId?: string; taskId?: string; workflowId?: string; context?: Record<string, any>; duration_ms?: number }): void {
    this.log("info", message, {
      agentId,
      workflowId: opts?.workflowId,
      traceId: opts?.traceId,
      taskId: opts?.taskId,
      context: opts?.context,
      duration_ms: opts?.duration_ms,
    });
  }

  private log(
    level: LogLevel,
    message: string,
    opts?: {
      context?: Record<string, any>;
      traceId?: string;
      workflowId?: string;
      taskId?: string;
      agentId?: string;
      duration_ms?: number;
      error?: LogEntry["error"];
    }
  ): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      component: this.component,
      traceId: opts?.traceId,
      workflowId: opts?.workflowId,
      taskId: opts?.taskId,
      agentId: opts?.agentId,
      message,
      context: opts?.context,
      duration_ms: opts?.duration_ms,
      error: opts?.error,
    };
    writeLog(entry);
  }
}

// Singleton loggers
const loggers = new Map<LogComponent, OpenClawLogger>();

export function getLogger(component: LogComponent): OpenClawLogger {
  if (!loggers.has(component)) loggers.set(component, new OpenClawLogger(component));
  return loggers.get(component)!;
}

export const orchestratorLogger = getLogger("orchestrator");
export const agentLogger = getLogger("agent");
export const workflowLogger = getLogger("workflow");
export const tracerLogger = getLogger("tracer");
export const selfHealingLogger = getLogger("self_healing");