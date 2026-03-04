"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DependencyGraphBuilder = void 0;
exports.createDependencyGraph = createDependencyGraph;
const logger_1 = require("./logger");
class DependencyGraphBuilder {
    logger = logger_1.orchestratorLogger;
    fileIndex;
    constructor(fileIndex) {
        this.fileIndex = fileIndex;
    }
    async build() {
        const start = Date.now();
        const graph = {
            version: '1.0',
            generated_at: new Date().toISOString(),
            nodes: {},
            edges: {},
            stats: { total_nodes: 0, total_edges: 0, cycles: 0, orphan_nodes: 0 },
        };
        for (const [relPath, entry] of Object.entries(this.fileIndex.files)) {
            graph.nodes[relPath] = { path: relPath, file_type: entry.file_type, agent_types: entry.agent_types, dependents: [], dependencies: [], fanout_score: 0, cycle_risk: 'low' };
        }
        graph.stats.total_nodes = Object.keys(graph.nodes).length;
        await this.buildImportEdges(graph);
        this.calculateFanoutScores(graph);
        const cycles = this.detectCycles(graph);
        graph.stats.cycles = cycles.length;
        this.markCycleRisk(graph, cycles);
        graph.stats.orphan_nodes = Object.values(graph.nodes).filter(n => n.dependencies.length === 0).length;
        graph.stats.total_edges = Object.keys(graph.edges).length;
        const duration = Date.now() - start;
        this.logger.info(`Dependency graph: ${graph.stats.total_nodes} nodes, ${graph.stats.total_edges} edges, ${graph.stats.cycles} cycles`);
        return graph;
    }
    async buildImportEdges(graph) {
        for (const [sourcePath, entry] of Object.entries(this.fileIndex.files)) {
            if (!entry.imports)
                continue;
            for (const importedModule of entry.imports) {
                const targetPath = this.resolveImport(importedModule, sourcePath);
                if (targetPath && graph.nodes[targetPath]) {
                    const edgeKey = `${sourcePath}->${targetPath}`;
                    if (!graph.edges[edgeKey]) {
                        graph.edges[edgeKey] = { source: sourcePath, target: targetPath, weight: 1, reason: 'import' };
                        graph.nodes[sourcePath].dependencies.push(targetPath);
                        graph.nodes[targetPath].dependents.push(sourcePath);
                    }
                }
            }
        }
    }
    resolveImport(module, fromPath) {
        const candidates = [module + '.swift', module.toLowerCase() + '.swift'];
        for (const candidate of candidates) {
            if (this.fileIndex.files[candidate])
                return candidate;
        }
        return null;
    }
    calculateFanoutScores(graph) {
        for (const node of Object.values(graph.nodes)) {
            const deps = node.dependencies.length || 1;
            node.fanout_score = Number((node.dependents.length / deps).toFixed(3));
        }
    }
    detectCycles(graph) {
        const visited = new Set();
        const recStack = new Set();
        const stack = [];
        const cycles = [];
        const dfs = (nodePath) => {
            visited.add(nodePath);
            recStack.add(nodePath);
            stack.push(nodePath);
            const node = graph.nodes[nodePath];
            if (node) {
                for (const neighbor of node.dependencies) {
                    if (!visited.has(neighbor)) {
                        if (dfs(neighbor))
                            return true;
                    }
                    else if (recStack.has(neighbor)) {
                        const start = stack.indexOf(neighbor);
                        const cycleNodes = stack.slice(start).concat(neighbor);
                        cycles.push({ nodes: cycleNodes, length: cycleNodes.length });
                    }
                }
            }
            recStack.delete(nodePath);
            stack.pop();
            return false;
        };
        for (const nodePath of Object.keys(graph.nodes)) {
            if (!visited.has(nodePath))
                dfs(nodePath);
        }
        return cycles;
    }
    markCycleRisk(graph, cycles) {
        const cycleNodeSet = new Set();
        for (const cycle of cycles) {
            for (const node of cycle.nodes)
                cycleNodeSet.add(node);
        }
        for (const nodePath of cycleNodeSet) {
            graph.nodes[nodePath].cycle_risk = 'high';
        }
        for (const node of Object.values(graph.nodes)) {
            if (node.fanout_score > 5 && node.cycle_risk === 'low')
                node.cycle_risk = 'medium';
        }
    }
    detectConflicts(tasks) {
        const fileToAgents = new Map();
        const conflictingPairs = [];
        for (const task of tasks) {
            for (const file of task.targetFiles) {
                if (!fileToAgents.has(file))
                    fileToAgents.set(file, new Set());
                fileToAgents.get(file).add(task.agentId);
            }
        }
        for (const [file, agents] of fileToAgents.entries()) {
            if (agents.size > 1) {
                const agentList = Array.from(agents);
                for (let i = 0; i < agentList.length; i++) {
                    for (let j = i + 1; j < agentList.length; j++) {
                        conflictingPairs.push({ file1: agentList[i], file2: agentList[j], reason: `Multiple agents on file: ${file}` });
                    }
                }
            }
        }
        return {
            hasConflicts: conflictingPairs.length > 0,
            conflictingPairs,
            serializationCandidates: Array.from(fileToAgents.entries()).filter(([, agents]) => agents.size > 1).map(([file]) => file),
        };
    }
}
exports.DependencyGraphBuilder = DependencyGraphBuilder;
function createDependencyGraph(fileIndex) {
    return new DependencyGraphBuilder(fileIndex);
}
