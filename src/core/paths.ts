import { join } from 'path';
import { cwd } from 'process';

/**
 * Path abstraction for OpenClaw runtime data.
 * All data directories are relative to OPENCLAW_DATA_DIR or fallback to cwd/.openclaw.
 */

export function getDataDir(): string {
  const envDir = process.env.OPENCLAW_DATA_DIR;
  return envDir ? envDir : join(cwd(), '.openclaw');
}

export function getLogsDir(): string {
  return join(getDataDir(), 'logs');
}

export function getArtifactsDir(): string {
  return join(getDataDir(), 'artifacts');
}

export function getWorkflowsDir(): string {
  return join(getDataDir(), 'workflows');
}

export function getMetricsDir(): string {
  return join(getDataDir(), 'metrics');
}

export function getConfigDir(): string {
  return join(getDataDir(), 'config');
}

export function getDistDir(): string {
  return join(getDataDir(), 'dist');
}
