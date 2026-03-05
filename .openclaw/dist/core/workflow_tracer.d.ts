export type WorkflowStatus = 'running' | 'completed' | 'failed' | 'cancelled';
export interface WorkflowTrace {
    traceId: string;
    workflowId: string;
    status: WorkflowStatus;
    startedAt: string;
    completedAt?: string;
    durationMs?: number;
    stages: StageTrace[];
    errors: ErrorTrace[];
    context?: Record<string, any>;
}
export interface StageTrace {
    stageId: string;
    agentId: string;
    taskId?: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
    startedAt?: string;
    completedAt?: string;
    durationMs?: number;
    output?: Record<string, any>;
    error?: ErrorTrace;
}
export interface ErrorTrace {
    code: string;
    message: string;
    stageId?: string;
    taskId?: string;
    agentId?: string;
    retryable: boolean;
    fallbackUsed?: string;
    stack?: string;
}
export declare class WorkflowTracer {
    private trace;
    private logger;
    constructor(workflowId: string, context?: Record<string, any>);
    startStage(stageId: string, agentId: string, taskId?: string): void;
    completeStage(stageId: string, output?: Record<string, any>): void;
    failStage(stageId: string, error: ErrorTrace): void;
    complete(): WorkflowTrace;
    fail(error: ErrorTrace): WorkflowTrace;
    cancel(): WorkflowTrace | null;
    getTraceId(): string | undefined;
    getWorkflowId(): string | undefined;
    isActive(): boolean;
    saveToFile(): void;
}
export declare function startWorkflowTrace(workflowId: string, context?: Record<string, any>): WorkflowTracer;
export declare function getActiveTrace(): WorkflowTracer | null;
export declare function endWorkflowTrace(): WorkflowTrace | null;
export declare function failWorkflowTrace(error: {
    code: string;
    message: string;
    retryable?: boolean;
    stack?: string;
}): WorkflowTrace | null;
//# sourceMappingURL=workflow_tracer.d.ts.map