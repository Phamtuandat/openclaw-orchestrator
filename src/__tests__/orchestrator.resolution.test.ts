import { Orchestrator } from '../src/core/orchestrator';
import { WorkflowContext } from '../src/core/orchestrator';

// Mock dependencies
jest.mock('../src/core/logger', () => ({
  orchestratorLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../src/core/metrics', () => ({
  Metrics: {
    getInstance: () => ({
      emit: jest.fn().mockResolvedValue(undefined),
    }),
  },
}));

jest.mock('../src/core/circuit_breaker', () => ({
  CircuitBreaker: class {
    isOpen() { return false; }
    record() {}
  },
}));

describe('Orchestrator - Config-Driven Agent Resolution', () => {
  let orchestrator: Orchestrator;

  beforeEach(async () => {
    // Create orchestrator instance
    orchestrator = new Orchestrator();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('resolveAgentExecution', () => {
    const mockStage = { id: 'test-stage', agentId: 'test-agent' };
    const mockContext: WorkflowContext = {
      workflowId: 'test-workflow',
      inputs: {},
      traceId: 'test-trace',
    };

    it('should fallback to original agentId and default model when no config loaded', () => {
      // agentMapping should be null by default if no config file
      const result = (orchestrator as any).resolveAgentExecution(mockStage, mockContext);

      expect(result.agentId).toBe('test-agent');
      expect(result.model).toBeDefined();
      expect(result.source).toBe('fallback');
    });

    it('should use overridden agentId and model from config mapping', () => {
      // Simulate config loading
      (orchestrator as any).agentMapping = {
        version: '1.0',
        mappings: [
          { stageAgentId: 'test-agent', agentId: 'overridden-agent', model: 'custom-model' },
        ],
      };

      const result = (orchestrator as any).resolveAgentExecution(mockStage, mockContext);

      expect(result.agentId).toBe('overridden-agent');
      expect(result.model).toBe('custom-model');
      expect(result.source).toBe('config');
    });

    it('should keep original agentId if mapping provides only model override', () => {
      (orchestrator as any).agentMapping = {
        version: '1.0',
        mappings: [
          { stageAgentId: 'test-agent', model: 'override-model' },
        ],
      };

      const result = (orchestrator as any).resolveAgentExecution(mockStage, mockContext);

      expect(result.agentId).toBe('test-agent');
      expect(result.model).toBe('override-model');
      expect(result.source).toBe('config');
    });

    it('should fallback to getModelForAgent if mapping has no model and no agentId override', () => {
      (orchestrator as any).agentMapping = {
        version: '1.0',
        mappings: [
          { stageAgentId: 'test-agent' },
        ],
      };

      const result = (orchestrator as any).resolveAgentExecution(mockStage, mockContext);

      expect(result.agentId).toBe('test-agent');
      // getModelForAgent returns 'openai-codex/gpt-5.3-codex' for unknown agentId
      expect(result.model).toBe('openai-codex/gpt-5.3-codex');
      expect(result.source).toBe('config');
    });

    it('should handle malformed config gracefully by falling back', () => {
      (orchestrator as any).agentMapping = {
        version: '1.0',
        mappings: null as any, // malformed
      };

      expect(() => (orchestrator as any).resolveAgentExecution(mockStage, mockContext))
        .toThrow(); // Should throw due to malformed

      // But we catch and fallback - actually resolveAgentExecution catches errors and logs, returns fallback
      const result = (orchestrator as any).resolveAgentExecution(mockStage, mockContext);
      expect(result.source).toBe('fallback');
    });

    it('should log resolution info for debugging', () => {
      const loggerInfo = jest.spyOn((orchestrator as any).logger, 'info');

      (orchestrator as any).agentMapping = {
        version: '1.0',
        mappings: [
          { stageAgentId: 'test-agent', agentId: 'new-agent', model: 'new-model' },
        ],
      };

      (orchestrator as any).resolveAgentExecution(mockStage, mockContext);

      expect(loggerInfo).toHaveBeenCalledWith(
        expect.stringContaining('Resolved stage test-stage'),
        expect.stringContaining('originalAgent=test-agent'),
        expect.stringContaining('agent=new-agent'),
        expect.stringContaining('model=new-model'),
        expect.stringContaining('source: config')
      );
    });
  });

  describe('executeWorkflow integration with resolveAgentExecution', () => {
    it('should pass resolved model to executeStage', async () => {
      // This is an integration check - we mock resolveAgentExecution and verify executeStage gets correct args
      const mockWorkflow = {
        id: 'test-wf',
        name: 'Test',
        version: '1.0',
        stages: [
          { id: 's1', agentId: 'agent1', task: 'do something' },
        ],
        max_parallel: 1,
        timeout_minutes: 10,
      };

      // Load workflow directly into orchestrator's private map
      (orchestrator as any).loadedWorkflows.set('test-wf', mockWorkflow);

      // Mock resolveAgentExecution to return specific values
      const resolveMock = jest
        .spyOn(orchestrator as any, 'resolveAgentExecution')
        .mockReturnValue({ agentId: 'resolved-agent', model: 'resolved-model', source: 'config' });

      // Mock executeStage to capture its arguments
      const executeStageMock = jest
        .spyOn(orchestrator as any, 'executeStage')
        .mockResolvedValue({
          stageId: 's1',
          agentId: 'resolved-agent',
          status: 'completed',
          output: {},
          durationMs: 100,
          modelUsed: 'resolved-model',
        });

      const context: WorkflowContext = {
        workflowId: 'test-wf',
        inputs: {},
        traceId: 'trace-123',
      };

      try {
        await (orchestrator as any).executeWorkflow('test-wf', context);
      } catch (err) {
        // ignore errors from mocked components
      }

      expect(resolveMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: 's1', agentId: 'agent1' }),
        context
      );

      // executeStage should be called with resolvedModel as 5th argument
      expect(executeStageMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: 's1' }),
        context,
        expect.anything(),
        expect.any(Number),
        'resolved-model'
      );
    });
  });
});
