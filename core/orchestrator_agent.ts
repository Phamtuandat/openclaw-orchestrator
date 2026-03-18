import { Orchestrator } from './orchestrator';
import { FileIndexBuilder } from './file_index_builder';
import { DependencyGraphBuilder } from './dependency_graph_builder';
import { WorkflowTracer } from './workflow_tracer';
import { orchestratorLogger } from './logger';
import { setAgentDispatcher, GatewayToolDispatcher } from './agent_dispatcher';

// Ensure the GatewayToolDispatcher is used
setAgentDispatcher(new GatewayToolDispatcher());

// Global tools injected by gateway; available in global scope
declare const tools: any;

async function handleTurn(input: any, context: any): Promise<any> {
  const text = input?.text?.trim() || '';
  const traceId = context?.traceId || `trace-${Date.now()}`;
  orchestratorLogger.info(`[Agent] Handling turn: ${text}`);

  // Parse workflow ID
  let workflowId = text;
  if (text.toLowerCase().startsWith('run ')) {
    workflowId = text.slice(4).trim();
  }
  if (!workflowId) {
    return { output: 'Please specify a workflow name (e.g., "crash_hunter").', error: true };
  }

  try {
    // Determine project path
    const projectPath = process.env.OPENCLAW_WORKSPACE || process.cwd();

    // Build file index (could be cached later)
    const fileIndexBuilder = new FileIndexBuilder(projectPath);
    const fileIndex = await fileIndexBuilder.build();

    // Build dependency graph
    const depBuilder = new DependencyGraphBuilder(fileIndex);
    const dependencyGraph = await depBuilder.build();

    // Create tracer
    const tracer = new WorkflowTracer(traceId);

    // Execute workflow
    const result = await Orchestrator.execute(workflowId, {
      workflowId,
      inputs: input?.args || {},
      fileIndex,
      dependencyGraph,
      traceId,
    });

    return {
      output: result.finalOutput || `Workflow ${workflowId} completed`,
      stages: result.stages,
      traceId: result.traceId,
      durationMs: result.durationMs,
    };
  } catch (err: any) {
    orchestratorLogger.error(`[Agent] Workflow failed: ${err.message}`);
    return {
      output: `Error: ${err.message}`,
      error: true,
    };
  }
}

// Main loop: read stdin messages (JSON lines) and respond
let buffer = '';
process.stdin.setEncoding('utf8');

process.stdin.on('data', (chunk: string) => {
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop() || '';

  for (const line of lines) {
    if (!line.trim()) continue;
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch (e) {
      orchestratorLogger.error(`Failed to parse message: ${e}`);
      continue;
    }

    if (msg.type !== 'turn') continue;

    (async () => {
      try {
        const response = await handleTurn(msg.input, msg.context);
        const out = {
          type: 'turn-result',
          result: response,
        };
        console.log(JSON.stringify(out));
      } catch (err) {
        orchestratorLogger.error(`handleTurn error: ${err}`);
        const out = {
          type: 'turn-result',
          result: { output: `Internal error: ${err}`, error: true },
        };
        console.log(JSON.stringify(out));
      }
    })();
  }
});

process.stdin.on('end', () => {
  orchestratorLogger.info('Stdin closed');
});

process.on('unhandledRejection', (err) => {
  orchestratorLogger.error('Unhandled rejection:', err);
});
