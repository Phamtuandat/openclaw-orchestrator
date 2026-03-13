export class CircuitBreaker {
  private states: Map<string, BreakerState> = new Map();
  private readonly failureThreshold: number;
  private readonly openDurationMs: number;
  private readonly halfOpenMaxCalls: number;

  constructor() {
    this.failureThreshold = parseInt(process.env.OPENCLAW_CIRCUIT_FAILURE_THRESHOLD || '5', 10);
    this.openDurationMs = parseInt(process.env.OPENCLAW_CIRCUIT_OPEN_DURATION_MS || '30000', 10);
    this.halfOpenMaxCalls = parseInt(process.env.OPENCLAW_CIRCUIT_HALF_OPEN_MAX_CALLS || '3', 10);
  }

  isOpen(agentId: string): boolean {
    const state = this.getState(agentId);
    const now = Date.now();

    if (state.isOpen) {
      if (now >= state.openUntil) {
        // Transition to half-open: allow one trial call
        state.isOpen = false;
        state.failures = 0;
        return false;
      }
      return true;
    }
    return false;
  }

  record(agentId: string, success: boolean): void {
    const state = this.getState(agentId);
    const now = Date.now();

    if (success) {
      state.failures = 0;
      state.isOpen = false;
      state.openUntil = 0;
      return;
    }

    state.failures++;
    if (state.failures >= this.failureThreshold) {
      state.isOpen = true;
      state.openUntil = now + this.openDurationMs;
    }
  }

  private getState(agentId: string): BreakerState {
    if (!this.states.has(agentId)) {
      this.states.set(agentId, { failures: 0, lastFailureTime: 0, isOpen: false, openUntil: 0 });
    }
    return this.states.get(agentId)!;
  }
}

interface BreakerState {
  failures: number;
  lastFailureTime: number;
  isOpen: boolean;
  openUntil: number;
}
