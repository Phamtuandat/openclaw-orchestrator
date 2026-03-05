import { FileIndex } from './file_index_builder';
export interface DependencyGraph {
    version: string;
    generated_at: string;
    nodes: Record<string, GraphNode>;
    edges: Record<string, GraphEdge>;
    stats: {
        total_nodes: number;
        total_edges: number;
        cycles: number;
        orphan_nodes: number;
    };
}
export interface GraphNode {
    path: string;
    file_type: string;
    agent_types: string[];
    dependents: string[];
    dependencies: string[];
    fanout_score: number;
    cycle_risk: 'low' | 'medium' | 'high';
}
export interface GraphEdge {
    source: string;
    target: string;
    weight: number;
    reason: string;
}
export interface ConflictDetectResult {
    hasConflicts: boolean;
    conflictingPairs: Array<{
        file1: string;
        file2: string;
        reason: string;
    }>;
    serializationCandidates: string[];
}
export declare class DependencyGraphBuilder {
    private logger;
    private fileIndex;
    constructor(fileIndex: FileIndex);
    build(): Promise<DependencyGraph>;
    private buildImportEdges;
    private resolveImport;
    private calculateFanoutScores;
    private detectCycles;
    private markCycleRisk;
    detectConflicts(tasks: Array<{
        agentId: string;
        targetFiles: string[];
    }>): ConflictDetectResult;
    getExecutionOrder(tasks: Array<{
        id: string;
        agentId: string;
        targetFiles: string[];
    }>): string[];
}
export declare function createDependencyGraph(fileIndex: FileIndex): DependencyGraphBuilder;
//# sourceMappingURL=dependency_graph_builder.d.ts.map