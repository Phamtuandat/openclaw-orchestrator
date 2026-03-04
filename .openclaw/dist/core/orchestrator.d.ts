import { FileIndex } from './file_index_builder';
export interface WorkflowDefinition {
    id: string;
    name: string;
    version: string;
    description?: string;
    stages: Array<{
        id: string;
        agentId: string;
        task: string;
        dependsOn?: string[];
        parallel?: boolean;
        targets?: {
            file_patterns?: string[];
        };
        timeout_seconds?: number;
        outputs?: string[];
    }>;
    max_parallel: number;
    timeout_minutes: number;
}
export interface WorkflowContext {
    workflowId: string;
    inputs: Record<string, any>;
    fileIndex?: FileIndex;
    traceId: string;
}
export interface TaskResult {
    stageId: string;
    agentId: string;
    status: 'completed' | 'failed' | 'skipped';
    output?: Record<string, any>;
    error?: {
        code: string;
        message: string;
        retryable: boolean;
    };
    durationMs: number;
}
export interface WorkflowResult {
    workflowId: string;
    status: 'completed' | 'failed' | 'cancelled';
    traceId: string;
    startedAt: string;
    completedAt: string;
    durationMs: number;
    stages: TaskResult[];
    errors: Array<{
        stageId?: string;
        code: string;
        message: string;
    }>;
    finalOutput?: Record<string, any>;
}
export declare class Orchestrator {
    private logger;
    private workflowsDir;
    private loadedWorkflows;
    constructor(workflowsDir?: string);
    private loadAllWorkflows;
    private loadWorkflowFile;
    getWorkflow(id: string): WorkflowDefinition | undefined;
    listWorkflows(): Array<{
        id: string;
        name: string;
        version: string;
        stages: number;
    }>;
    executeWorkflow(workflowId: string, context: WorkflowContext): Promise<WorkflowResult>;
    private planExecution;
    private mockAgentDispatch;
    private aggregateOutputs;
    static execute(workflowId: string, context: WorkflowContext): Promise<WorkflowResult>;
}
//# sourceMappingURL=orchestrator.d.ts.map