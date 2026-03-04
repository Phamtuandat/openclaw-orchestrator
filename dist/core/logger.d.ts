export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export interface LogEntry {
    timestamp: string;
    level: LogLevel;
    component: string;
    traceId?: string;
    workflowId?: string;
    taskId?: string;
    agentId?: string;
    message: string;
    context?: Record<string, any>;
    duration_ms?: number;
    error?: {
        code: string;
        message: string;
        retryable?: boolean;
    };
}
export declare class OpenClawLogger {
    private component;
    constructor(component: string);
    debug(msg: string, ctx?: Record<string, any>, traceId?: string): void;
    info(msg: string, ctx?: Record<string, any>, traceId?: string): void;
    warn(msg: string, ctx?: Record<string, any>, traceId?: string): void;
    error(msg: string, err?: Error | {
        code: string;
        message: string;
        retryable?: boolean;
    } | undefined, traceId?: string): void;
    workflow(workflowId: string, taskId?: string, msg: string, ctx?: Record<string, any>): void;
    agent(agentId: string, taskId?: string, msg: string, ctx?: Record<string, any>): void;
    private log;
}
export declare function getLogger(component: string): OpenClawLogger;
export declare const orchestratorLogger: OpenClawLogger;
export declare const agentLogger: OpenClawLogger;
export declare const workflowLogger: OpenClawLogger;
//# sourceMappingURL=logger.d.ts.map