#!/usr/bin/env tsx
/**
 * Simple test runner for orchestrator resolution logic
 * Run with: npx tsx src/__tests__/manual-test-resolution.ts
 */

import { Orchestrator } from '../core/orchestrator';

// Minimal mocks
const mockLogger = {
  info: (...args: any[]) => console.log('[INFO]', ...args),
  warn: (...args: any[]) => console.warn('[WARN]', ...args),
  error: (...args: any[]) => console.error('[ERROR]', ...args),
};

// Override logger for testing
const orchestrator = new Orchestrator();

// Test cases
interface TestCase {
  name: string;
  mapping?: any;
  stageAgentId: string;
  expectedAgentId: string;
  expectedModel?: string;
  expectedSource: 'config' | 'fallback';
}

const testCases: TestCase[] = [
  {
    name: 'No config loaded -> fallback',
    stageAgentId: 'any-agent',
    expectedAgentId: 'any-agent',
    expectedSource: 'fallback',
  },
  {
    name: 'Mapping with full override',
    mapping: {
      version: '1.0',
      mappings: [{ stageAgentId: 'agent-a', agentId: 'new-agent', model: 'custom-model' }],
    },
    stageAgentId: 'agent-a',
    expectedAgentId: 'new-agent',
    expectedModel: 'custom-model',
    expectedSource: 'config',
  },
  {
    name: 'Mapping with model only override',
    mapping: {
      version: '1.0',
      mappings: [{ stageAgentId: 'agent-b', model: 'override-model' }],
    },
    stageAgentId: 'agent-b',
    expectedAgentId: 'agent-b',
    expectedModel: 'override-model',
    expectedSource: 'config',
  },
  {
    name: 'Mapping with agentId only override (model from getModelForAgent)',
    mapping: {
      version: '1.0',
      mappings: [{ stageAgentId: 'agent-c', agentId: 'different-agent' }],
    },
    stageAgentId: 'agent-c',
    expectedAgentId: 'different-agent',
    expectedSource: 'config',
  },
  {
    name: 'No mapping exists for stage -> fallback',
    mapping: {
      version: '1.0',
      mappings: [{ stageAgentId: 'other-agent', agentId: 'other' }],
    },
    stageAgentId: 'agent-not-mapped',
    expectedAgentId: 'agent-not-mapped',
    expectedSource: 'fallback',
  },
];

async function runTests() {
  console.log('Testing orchestrator config-driven resolution\n');
  let passed = 0;
  let failed = 0;

  for (const tc of testCases) {
    // Setup mapping
    if (tc.mapping) {
      (orchestrator as any).agentMapping = tc.mapping;
    } else {
      (orchestrator as any).agentMapping = null;
    }

    const stage = { id: 'test-stage', agentId: tc.stageAgentId };
    const context = { workflowId: 'test', inputs: {}, traceId: 'trace' } as any;

    const result = (orchestrator as any).resolveAgentExecution(stage, context);

    const ok =
      result.agentId === tc.expectedAgentId &&
      result.source === tc.expectedSource &&
      (!tc.expectedModel || result.model === tc.expectedModel);

    if (ok) {
      console.log(`✅ ${tc.name}`);
      passed++;
    } else {
      console.log(`❌ ${tc.name}`);
      console.log(`   Expected: agentId=${tc.expectedAgentId}, model=${tc.expectedModel}, source=${tc.expectedSource}`);
      console.log(`   Got:      agentId=${result.agentId}, model=${result.model}, source=${result.source}`);
      failed++;
    }
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
