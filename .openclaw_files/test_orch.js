import { Orchestrator } from './.openclaw/dist/core/orchestrator.js';

console.log('Testing orchestrator loading...');
const orch = new Orchestrator();
const workflows = orch.listWorkflows();
console.log('Available workflows:', workflows.map(w => w.id));

if (workflows.length === 0) {
  console.error('No workflows loaded!');
  process.exit(1);
}

const testWorkflow = workflows[0];
console.log(`Test using workflow: ${testWorkflow.id}`);

const result = await orch.executeWorkflow(testWorkflow.id, {
  workflowId: testWorkflow.id,
  inputs: { project_path: '/tmp/test-project' },
  traceId: 'test-' + Date.now(),
});

console.log('Result:', JSON.stringify(result, null, 2));