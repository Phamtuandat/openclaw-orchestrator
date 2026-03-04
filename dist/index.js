#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const orchestrator_1 = require("./core/orchestrator");
const file_index_builder_1 = require("./core/file_index_builder");
// CLI args
const args = process.argv.slice(2);
if (args.length === 0) {
    console.error('Usage: node index.ts <workflow-id> [inputs...]');
    console.error('Example: node index.ts crash_hunter project_path="/path/to/project"');
    process.exit(1);
}
const workflowId = args[0];
const inputs = {};
for (let i = 1; i < args.length; i++) {
    const [key, value] = args[i].split('=');
    if (key && value !== undefined) {
        try {
            inputs[key] = JSON.parse(value);
        }
        catch {
            inputs[key] = value;
        }
    }
}
async function main() {
    try {
        const orch = new orchestrator_1.Orchestrator();
        const workflow = orch.getWorkflow(workflowId);
        if (!workflow) {
            console.error(`Workflow '${workflowId}' not found. Available: ${orch.listWorkflows().map(w => w.id).join(', ')}`);
            process.exit(1);
        }
        if (inputs.project_path) {
            const fileIndex = await (0, file_index_builder_1.getOrBuildFileIndex)(inputs.project_path);
            (0, file_index_builder_1.saveFileIndex)(fileIndex);
            console.log(`File index: ${fileIndex.stats.total_files} files`);
        }
        const result = await orch.executeWorkflow(workflowId, {
            workflowId,
            inputs,
            traceId: 'cli-' + Date.now(),
        });
        console.log('\n' + '='.repeat(60));
        console.log(`Status: ${result.status}`);
        console.log(`Trace ID: ${result.traceId}`);
        console.log(`Duration: ${result.durationMs}ms`);
        console.log(`Stages: ${result.stages.length} (${result.stages.filter((s) => s.status === 'completed').length} completed, ${result.stages.filter((s) => s.status === 'failed').length} failed)`);
        console.log('='.repeat(60) + '\n');
        if (result.finalOutput) {
            console.log('Output:', JSON.stringify(result.finalOutput, null, 2));
        }
        if (result.errors.length > 0) {
            console.error('Errors:', result.errors);
        }
        process.exit(result.status === 'completed' ? 0 : 1);
    }
    catch (err) {
        console.error('Fatal:', err instanceof Error ? err.message : String(err));
        process.exit(1);
    }
}
main();
