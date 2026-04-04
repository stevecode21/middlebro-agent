import { readFileSync } from 'fs';
import type { PolicyConfig, ThreatType, Decision } from './types.js';

// Parses a JSON or YAML-like policy file into PolicyConfig.
// Supports .json files natively; YAML support can be added when needed.
export function loadPolicy(filePath: string): PolicyConfig {
  const raw = readFileSync(filePath, 'utf-8');

  let parsed: Record<string, unknown>;

  if (filePath.endsWith('.json')) {
    parsed = JSON.parse(raw);
  } else {
    throw new Error(`Unsupported policy file format: ${filePath}. Use .json`);
  }

  return validatePolicy(parsed);
}

function validatePolicy(raw: Record<string, unknown>): PolicyConfig {
  const config: Record<string, unknown> = {};

  if (Array.isArray(raw.blockOn)) config['blockOn'] = raw.blockOn;
  if (Array.isArray(raw.warnOn))  config['warnOn']  = raw.warnOn;
  if (raw.overrides && typeof raw.overrides === 'object') {
    config['overrides'] = raw.overrides as Partial<Record<ThreatType, Decision>>;
  }

  return config as PolicyConfig;
}
