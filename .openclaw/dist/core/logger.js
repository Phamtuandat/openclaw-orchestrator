"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.selfHealingLogger = exports.tracerLogger = exports.workflowLogger = exports.agentLogger = exports.orchestratorLogger = exports.OpenClawLogger = void 0;
exports.getLogger = getLogger;
const fs_1 = require("fs");
const path_1 = require("path");
const LOG_DIR = (0, path_1.join)(process.cwd(), ".openclaw", "logs");
// Map component -> directory name (avoid agent/agents + workflow/workflows mismatch)
const COMPONENT_DIR = {
    orchestrator: "orchestrator",
    agent: "agents",
    workflow: "workflows",
    self_healing: "self_healing",
    tracer: "traces",
};
function ensureDirs() {
    for (const dir of Object.values(COMPONENT_DIR)) {
        const p = (0, path_1.join)(LOG_DIR, dir);
        if (!(0, fs_1.existsSync)(p))
            (0, fs_1.mkdirSync)(p, { recursive: true });
    }
}
function writeLog(entry) {
    try {
        ensureDirs();
        const date = new Date().toISOString().split("T")[0];
        const dir = COMPONENT_DIR[entry.component] ?? entry.component;
        const file = (0, path_1.join)(LOG_DIR, dir, `${date}.log`);
        (0, fs_1.appendFileSync)(file, JSON.stringify(entry) + "\n", "utf8");
    }
    catch {
        // ignore logging errors
    }
}
function normalizeError(err) {
    if (!err)
        return undefined;
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
class OpenClawLogger {
    component;
    constructor(component) {
        this.component = component;
    }
    debug(message, opts) {
        this.log("debug", message, opts);
    }
    info(message, opts) {
        this.log("info", message, opts);
    }
    warn(message, opts) {
        this.log("warn", message, opts);
    }
    error(message, err, opts) {
        this.log("error", message, { ...opts, error: normalizeError(err) });
    }
    workflow(workflowId, message, opts) {
        // IMPORTANT: traceId must be provided by caller (do not fake it with workflowId)
        this.log("info", message, {
            workflowId,
            traceId: opts?.traceId,
            taskId: opts?.taskId,
            context: opts?.context,
            duration_ms: opts?.duration_ms,
        });
    }
    agent(agentId, message, opts) {
        this.log("info", message, {
            agentId,
            workflowId: opts?.workflowId,
            traceId: opts?.traceId,
            taskId: opts?.taskId,
            context: opts?.context,
            duration_ms: opts?.duration_ms,
        });
    }
    log(level, message, opts) {
        const entry = {
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
exports.OpenClawLogger = OpenClawLogger;
// Singleton loggers
const loggers = new Map();
function getLogger(component) {
    if (!loggers.has(component))
        loggers.set(component, new OpenClawLogger(component));
    return loggers.get(component);
}
exports.orchestratorLogger = getLogger("orchestrator");
exports.agentLogger = getLogger("agent");
exports.workflowLogger = getLogger("workflow");
exports.tracerLogger = getLogger("tracer");
exports.selfHealingLogger = getLogger("self_healing");
